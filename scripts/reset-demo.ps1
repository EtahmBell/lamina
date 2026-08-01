param(
  [string]$Database
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repositoryRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  throw "Python virtual environment is missing. Run .\scripts\setup.ps1."
}

$arguments = @((Join-Path $PSScriptRoot "reset-demo.py"))
if ($Database) {
  $arguments += @("--database", $Database)
}

Push-Location $repositoryRoot
try {
  & $python @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Lamina demo reset failed."
  }
} finally {
  Pop-Location
}
