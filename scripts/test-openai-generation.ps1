$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
  Write-Error "OPENAI_API_KEY is required. No request was made."
  exit 1
}

if ([string]::IsNullOrWhiteSpace($env:OPENAI_MODEL)) {
  Write-Error "OPENAI_MODEL is required. No request was made."
  exit 1
}

$baseUrl = if ($env:LAMINA_API_URL) { $env:LAMINA_API_URL } else { "http://127.0.0.1:8000" }
$body = @{
  agent_id = "agent-9000000999"
  raw_request = "Create a concise forum question about persistent nausea three days after a medication change. This is a synthetic case with no identifying information."
} | ConvertTo-Json

$draft = Invoke-RestMethod -Method Post -ContentType application/json `
  -Body $body -Uri "$baseUrl/forum/posts/drafts/generate"

Write-Host "Generated draft $($draft.id) in status $($draft.status)."
Write-Host "The draft was not approved or published. Review it through Ethan's inbox."
