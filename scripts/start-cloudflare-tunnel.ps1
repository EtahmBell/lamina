param(
  [string]$BackendUrl = "http://127.0.0.1:8001"
)

$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
  Write-Host "cloudflared must be installed before starting the Lamina Quick Tunnel."
  Write-Host "Install it with: winget install --id Cloudflare.cloudflared"
  exit 1
}

& $cloudflared.Source --version
if ($LASTEXITCODE -ne 0) {
  Write-Host "cloudflared is installed but its version check failed. Reinstall it before continuing."
  exit 1
}

try {
  $health = Invoke-RestMethod -Method Get -Uri "$BackendUrl/health" -TimeoutSec 5
  if ($health.status -ne "ok") {
    throw "Unexpected health response."
  }
} catch {
  Write-Host "Start the Lamina backend before starting the tunnel."
  exit 1
}

Write-Host "Starting a temporary Cloudflare Quick Tunnel for $BackendUrl."
Write-Host "cloudflared will print an HTTPS URL ending in .trycloudflare.com."
Write-Host "Copy that URL into Vercel as VITE_API_BASE_URL, redeploy, and leave this window running during the demo."
Write-Host "Press Ctrl+C to stop the tunnel. Closing this window invalidates the Quick Tunnel endpoint."

& $cloudflared.Source tunnel --url $BackendUrl
exit $LASTEXITCODE
