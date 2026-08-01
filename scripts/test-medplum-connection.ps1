$ErrorActionPreference = "Stop"

if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $name = $Matches[1]
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $Matches[2].Trim('"', "'"), "Process")
      }
    }
  }
}

$required = @("MEDPLUM_BASE_URL", "MEDPLUM_TOKEN_URL", "MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET", "MEDPLUM_PROJECT_ID")
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    Write-Error "$name is required in the API server environment. No credentials were printed."
    exit 1
  }
}

$baseUrl = if ($env:LAMINA_API_URL) { $env:LAMINA_API_URL } else { "http://127.0.0.1:8001" }
$health = Invoke-RestMethod -Method GET -Uri "$baseUrl/integrations/medplum/health"
if (-not ($health.configured -and $health.authenticated -and $health.fhir_reachable)) {
  Write-Error "Medplum health check failed."
  exit 1
}
Write-Host "Medplum authentication and FHIR connectivity succeeded."
