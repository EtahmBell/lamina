param(
  [string]$PostId
)

$ErrorActionPreference = "Stop"
$baseUrl = if ($env:LAMINA_API_URL) { $env:LAMINA_API_URL } else { "http://127.0.0.1:8001" }

Invoke-RestMethod -Method GET -Uri "$baseUrl/health" | Out-Null
$health = Invoke-RestMethod -Method GET -Uri "$baseUrl/integrations/medplum/health"
if (-not ($health.configured -and $health.authenticated -and $health.fhir_reachable)) {
  throw "Medplum health check failed."
}

$seedOutput = & .\scripts\seed-medplum-demo-patient.ps1 2>&1
$indexLine = $seedOutput | Where-Object { $_ -match '^ethan_index Patient:\s*(.+)$' } | Select-Object -First 1
if (-not $indexLine) { throw "Synthetic Ethan index case could not be located." }
$ethanPatientId = ([regex]::Match($indexLine, '^ethan_index Patient:\s*(.+)$')).Groups[1].Value.Trim()

$context = Invoke-RestMethod -Method GET -Uri "$baseUrl/medplum/patients/$ethanPatientId/case-context"
Write-Host "Ethan synthetic index context: age band $($context.age_band); $($context.conditions.Count) condition(s), $($context.medications.Count) medication(s), $($context.observations.Count) observation(s)."

if (-not $PostId) {
  $body = @{
    agent_id = "agent-9000000999"
    physician_guidance = "Ask whether others have encountered a similar synthetic SGLT2-inhibitor presentation. Preserve uncertainty and do not diagnose."
  } | ConvertTo-Json
  $post = Invoke-RestMethod -Method POST -ContentType "application/json" -Body $body `
    -Uri "$baseUrl/medplum/patients/$ethanPatientId/forum-posts/generate"
  $PostId = $post.id
  Write-Host "Ethan post $PostId is $($post.status)."
  Write-Host "STOP: Ethan must review and approve the post. Rerun with -PostId $PostId after approval."
  exit 0
}

$post = Invoke-RestMethod -Method GET -Uri "$baseUrl/forum/posts/$PostId"
if ($post.status -ne "published") {
  Write-Host "STOP: Ethan post $PostId is not published. Ethan must approve it first."
  exit 0
}

$monitoring = Invoke-RestMethod -Method POST -Uri "$baseUrl/forum/posts/$PostId/monitor"
foreach ($result in $monitoring.results) {
  Write-Host "Candidate: $($result.physician_name); outcome: $($result.outcome); matched cases: $($result.matched_case_count); response: $($result.response_id)"
  if ($result.response_id) {
    $review = Invoke-RestMethod -Method GET `
      -Uri "$baseUrl/forum/responses/$($result.response_id)/grounding-review?physician_npi=9000001000"
    Write-Host "Grounding: $($review.grounding.source_system), $($review.grounding.matched_case_count) supporting synthetic case(s)."
    Write-Host "STOP: Lianne must review and approve this response manually."
  }
}
