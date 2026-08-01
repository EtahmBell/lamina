param(
  [string]$BackendUrl = "http://127.0.0.1:8001",
  [string]$FrontendUrl = "https://frontend-nu-weld-79.vercel.app/"
)

$ErrorActionPreference = "Stop"
$script:failureCount = 0
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$databaseResult = $null
$medplumReady = $false
$ethanPanelReady = $false
$liannePanelReady = $false

function Write-Pass([string]$Message) {
  Write-Host "PASS: $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
  $script:failureCount += 1
  Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Write-WarningResult([string]$Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $name = $Matches[1]
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        $value = $Matches[2].Trim().Trim('"', "'")
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }
}

Import-DotEnv (Join-Path $repositoryRoot ".env")

$python = Join-Path $repositoryRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $python) {
  Write-Pass "Python virtual environment is available."
} else {
  Write-Fail "Python virtual environment is missing. Run .\scripts\setup.ps1."
}

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($cloudflared) {
  Write-Pass "cloudflared is installed."
} else {
  Write-Fail "cloudflared is not installed. Run: winget install --id Cloudflare.cloudflared"
}

$databaseSetting = if ($env:LAMINA_DB_PATH) {
  $env:LAMINA_DB_PATH
} else {
  "data/processed/lamina.sqlite"
}
$databasePath = if ([System.IO.Path]::IsPathRooted($databaseSetting)) {
  $databaseSetting
} else {
  Join-Path $repositoryRoot $databaseSetting
}

if (-not (Test-Path -LiteralPath $databasePath)) {
  Write-Fail "The Lamina SQLite database is unavailable."
} elseif (Test-Path -LiteralPath $python) {
  try {
    $databaseCheckScript = Join-Path $PSScriptRoot "check-demo-database.py"
    $databaseCheckOutput = & $python $databaseCheckScript $databasePath
    if ($LASTEXITCODE -ne 0) {
      throw "Database inspection failed."
    }
    $databaseResult = ($databaseCheckOutput | Out-String) | ConvertFrom-Json
    if ($databaseResult.application_schema) {
      Write-Pass "Lamina application tables are available in SQLite."
    } else {
      Write-Fail "Lamina application tables are incomplete."
    }
    if ($databaseResult.nppes_count -gt 0) {
      Write-Pass "The NPPES physician directory is available ($($databaseResult.nppes_count) imported physicians)."
    } else {
      Write-Fail "No imported NPPES physicians were found."
    }
    if (
      $databaseResult.demo_physicians -eq 2 -and
      $databaseResult.demo_agents -eq 2 -and
      $databaseResult.demo_memberships -eq 2 -and
      $databaseResult.demo_configurations -eq 2 -and
      $databaseResult.medplum_practitioner_mappings -eq 2
    ) {
      Write-Pass "Synthetic profiles, active configuration, memberships, and Medplum mappings are ready."
    } else {
      Write-Fail "Synthetic Ethan and Lianne demo setup is incomplete."
    }
    if (
      $databaseResult.demo_agent_statuses."agent-9000000999" -eq "active" -and
      $databaseResult.demo_agent_statuses."agent-9000001000" -eq "active"
    ) {
      Write-Pass "Ethan and Lianne agents are active."
    } else {
      Write-Fail "Ethan and Lianne must both be active before recording."
    }
    if ($databaseResult.published_posts -eq 0 -and $databaseResult.pending_responses -eq 0) {
      Write-Pass "Forum starts clean with zero published posts and zero pending responses."
    } else {
      Write-Fail "Forum is not clean. Run .\scripts\reset-demo.ps1 before recording."
    }
  } catch {
    Write-Fail "The Lamina SQLite database could not be inspected safely."
  }
}

$backendReachable = $false
try {
  $backendHealth = Invoke-RestMethod -Method Get -Uri "$BackendUrl/health" -TimeoutSec 5
  if ($backendHealth.status -eq "ok") {
    $backendReachable = $true
    Write-Pass "FastAPI is reachable at $BackendUrl."
  } else {
    Write-Fail "FastAPI returned an unexpected health response."
  }
} catch {
  Write-Fail "FastAPI is not reachable. Start the Lamina backend on port 8001."
}

if ($backendReachable) {
  try {
    $medplumHealth = Invoke-RestMethod -Method Get `
      -Uri "$BackendUrl/integrations/medplum/health" -TimeoutSec 20
    if (
      $medplumHealth.configured -and
      $medplumHealth.authenticated -and
      $medplumHealth.fhir_reachable
    ) {
      $medplumReady = $true
      Write-Pass "Medplum authentication and FHIR connectivity are healthy."
    } else {
      Write-Fail "Medplum is not fully configured, authenticated, and reachable."
    }
  } catch {
    Write-Fail "Medplum health check failed through the Lamina backend."
  }

  foreach ($physician in @(
    @{ Name = "Ethan"; Npi = "9000000999" },
    @{ Name = "Lianne"; Npi = "9000001000" }
  )) {
    try {
      $panel = Invoke-RestMethod -Method Get `
        -Uri "$BackendUrl/physicians/$($physician.Npi)/patients" -TimeoutSec 20
      if ($panel.count -gt 0) {
        if ($physician.Name -eq "Ethan") { $ethanPanelReady = $true }
        if ($physician.Name -eq "Lianne") { $liannePanelReady = $true }
        Write-Pass "$($physician.Name) authorized synthetic patient panel is ready."
      } else {
        Write-Fail "$($physician.Name) authorized synthetic patient panel is empty."
      }
    } catch {
      Write-Fail "$($physician.Name) authorized synthetic patient panel could not be verified."
    }
  }

  try {
    $corsResponse = Invoke-WebRequest -UseBasicParsing -Method Options `
      -Uri "$BackendUrl/health" -TimeoutSec 5 `
      -Headers @{
        Origin = "https://frontend-nu-weld-79.vercel.app"
        "Access-Control-Request-Method" = "GET"
      }
    if (
      $corsResponse.Headers["Access-Control-Allow-Origin"] -eq
      "https://frontend-nu-weld-79.vercel.app"
    ) {
      Write-Pass "FastAPI CORS allows the deployed Vercel frontend origin."
    } else {
      Write-Fail "FastAPI CORS does not allow the deployed Vercel frontend origin."
    }
  } catch {
    Write-Fail "FastAPI CORS preflight for the deployed Vercel origin failed."
  }
}

if ($env:OPENAI_API_KEY -and $env:OPENAI_MODEL) {
  Write-Pass "OpenAI API key and model configuration are present in the backend environment."
} else {
  Write-Fail "OpenAI backend configuration is incomplete. No live OpenAI request was made."
}

try {
  $frontendResponse = Invoke-WebRequest -UseBasicParsing -Method Get `
    -Uri $FrontendUrl -TimeoutSec 15
  if ($frontendResponse.StatusCode -ge 200 -and $frontendResponse.StatusCode -lt 400) {
    Write-Pass "The deployed Vercel frontend is reachable."
  } else {
    Write-WarningResult "The deployed Vercel frontend returned HTTP $($frontendResponse.StatusCode)."
  }
} catch {
  Write-WarningResult "The deployed Vercel frontend could not be reached from this machine."
}

if ($script:failureCount -gt 0) {
  Write-Host "Demo readiness failed with $script:failureCount required check(s) unavailable." -ForegroundColor Red
  exit 1
}

$ethanStatus = $databaseResult.demo_agent_statuses."agent-9000000999".ToUpper()
$lianneStatus = $databaseResult.demo_agent_statuses."agent-9000001000".ToUpper()
Write-Host ""
Write-Host "LAMINA DEMO" -ForegroundColor Cyan
Write-Host "Application DB        READY"
Write-Host "NPPES directory       READY · $($databaseResult.nppes_count) physicians"
Write-Host "Ethan                 $ethanStatus"
Write-Host "Lianne                $lianneStatus"
Write-Host "Medplum               $(if ($medplumReady) { 'CONNECTED' } else { 'UNAVAILABLE' })"
Write-Host "Ethan patient panel   $(if ($ethanPanelReady) { 'READY' } else { 'UNAVAILABLE' })"
Write-Host "Lianne patient panel  $(if ($liannePanelReady) { 'READY' } else { 'UNAVAILABLE' })"
Write-Host "Published posts       $($databaseResult.published_posts)"
Write-Host "Pending responses     $($databaseResult.pending_responses)"
Write-Host ""
Write-Host "READY TO RECORD" -ForegroundColor Green
