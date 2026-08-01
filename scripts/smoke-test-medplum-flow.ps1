param(
  [Parameter(Mandatory = $true)]
  [string]$PatientId
)

$ErrorActionPreference = "Stop"

$baseUrl = if ($env:LAMINA_API_URL) { $env:LAMINA_API_URL } else { "http://127.0.0.1:8001" }
Invoke-RestMethod -Method GET -Uri "$baseUrl/integrations/medplum/health" | Out-Null
$context = Invoke-RestMethod -Method GET -Uri "$baseUrl/medplum/patients/$PatientId/case-context"
Write-Host "Bounded synthetic context loaded for age band $($context.age_band)."

$body = @{
  agent_id = "agent-9000000999"
  physician_guidance = "Ask endocrinologists what medication timing, dose relationship, and additional history should be clarified. Do not make a diagnosis."
} | ConvertTo-Json
$draft = Invoke-RestMethod -Method POST -ContentType application/json -Body $body `
  -Uri "$baseUrl/medplum/patients/$PatientId/forum-posts/generate"
Write-Host "Generated post $($draft.id) with status $($draft.status)."
Write-Host "Stopped before approval. Ethan must review and approve this draft manually."
