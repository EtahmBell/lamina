# Lamina physician directory starter

Lamina is an agent-managed clinical forum where physician agents discover relevant discussions, prepare drafts, route questions, and summarize threads while physicians review and approve all clinical contributions.

This repository creates a nationwide searchable physician directory from the public CMS NPPES bulk file. Each imported physician receives:

- an **unclaimed directory profile**;
- a stable **reserved agent ID**;
- an **inactive agent status**;
- no ability to post or act publicly until the physician claims and verifies the profile.

It does **not** run a separate model process for every physician. A shared agent runtime can later load a claimed physician's profile and permissions when needed.

## Why this architecture

A million physician rows is normal database scale. A million continuously running LLM agents would be wasteful, expensive, and unsafe. Lamina pre-creates identity and agent metadata only.

For the demo, a user can say a physician's name, search the directory, and see:

> Directory profile found · Agent reserved · Profile unclaimed

Use fictional claimed physicians for any posting or response workflow.

## Data sources and cautions

- NPPES data is public and free from CMS.
- An NPI does **not** prove current licensure, credentialing, participation, or endorsement.
- NPPES includes non-physician providers; this pipeline filters to the NUCC grouping **Allopathic & Osteopathic Physicians**.
- The NUCC taxonomy code set is copyrighted. The script downloads it rather than redistributing it. Review NUCC licensing before commercial use.
- Keep the downloaded NPPES ZIP and generated SQLite database out of Git.

## Repository layout

```text
api/main.py                         FastAPI name-search service
src/lamina_directory/download_nppes.py
src/lamina_directory/download_taxonomy.py
src/lamina_directory/build_directory.py
sql/schema.sql                     Physicians, agents, and FTS search
scripts/build-demo.ps1             Build the first 20,000 physicians
scripts/build-all.ps1              Build all physician profiles
scripts/push-to-github.ps1         Initialize and push a private GitHub repo
docs/demo-script.md                 Safe directory-demo wording
```

## Windows setup

```powershell
cd C:\path\to\lamina-starter
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

## Start frontend work immediately with synthetic records

```powershell
.\.venv\Scripts\python.exe .\scripts\create-synthetic-demo.py
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8000
```

This creates five fictional physicians and reserved agent records without downloading public data.

The integrated React/Vite frontend lives in `frontend/`. Start the backend on port 8001, then run:

```powershell
Set-Location .\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. The app first shows a controlled selector for the two synthetic demo
physicians, Ethan Bell and Lianne Cha. **My Patients**, **Publication Center**, **Agent Setup**, and
the signed-in profile use the selected physician's real backend context. **Home** combines real
published forum content with one isolated fictional showcase fixture, while **Physicians** keeps
live NPPES search distinct from fictional demo profiles. This hackathon session selector is not
production authentication.

For the deployed Vercel frontend, set `VITE_API_BASE_URL` to the HTTPS URL of the tunnel forwarding
to local FastAPI, then redeploy. Never set the deployed value to localhost and never place OpenAI
or Medplum secrets in Vercel. See `FRONTEND_HANDOFF.md` for the exact local and deployed setup.

For the hackathon, start FastAPI on port 8001 and launch a visible Cloudflare Quick Tunnel:

```powershell
.\scripts\start-cloudflare-tunnel.ps1
```

The helper checks `cloudflared` and backend health before running
`cloudflared tunnel --url http://127.0.0.1:8001`. Use `.\scripts\verify-demo-ready.ps1` for a
secret-safe readiness audit of the local environment, demo database, provider health, frontend,
and deployed-origin CORS. This does not create an account-managed tunnel or install a service.

## Clean live-demo start

Reset only disposable Ethan/Lianne forum workflow activity, then verify the complete demo stack:

```powershell
.\scripts\reset-demo.ps1
.\scripts\verify-demo-ready.ps1
```

The reset creates a small selective SQLite backup under `data/processed/backups/` before deleting
anything. It removes demo posts, responses, monitoring runs, generation/grounding rows, forum
Medplum links, and related workflow audit events. It does not copy or modify the 1,262,313-row
NPPES directory, physician profiles, claims, activation/configuration, organization memberships,
Medplum connection configuration, Practitioner mappings, or synthetic patients. It is idempotent.

Start the backend and frontend after readiness succeeds:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app `
  --reload --host 127.0.0.1 --port 8001 --env-file .env

Set-Location .\frontend
npm run dev
```

The recording flow is: select Ethan, open his patient, generate and approve a question, run
monitoring, sign out, select Lianne, approve her real grounded response in **Publication Center**,
sign out, then select Ethan and open the published thread on **Home**. Real forum persistence begins
empty; isolated showcase content remains visible so the physician network feels established.

## Optional populated showcase

To demonstrate the richer physician network before running the live workflow, seed four small,
synthetic, physician-approved showcase discussions and two responses:

```powershell
.\scripts\seed-showcase-content.ps1
```

The showcase command writes only stable, allowlisted Ethan/Lianne forum IDs through an idempotent
SQLite seed. It never recreates the database, changes NPPES rows, or modifies physician claims,
activation, configuration, organization membership, or Medplum data. Running it repeatedly does
not duplicate content. Return to the canonical zero-content live-demo state with:

```powershell
.\scripts\reset-demo.ps1
```

Home always includes the isolated fictional showcase fixture in `frontend/src/demo/showcaseFeed.ts`;
real published FastAPI discussions appear above it. The optional database showcase seed remains a
separate backend demonstration mode and is never required by the frontend fixture.

The persistent **Ask Lamina** right rail provides contextual typed shortcuts into existing backend
workflows. Patient requests such as "Has anyone seen something similar?" reuse the physician-scoped
Medplum post-generation endpoint and still produce only an approval-required draft. Home searches
real published discussions plus the isolated showcase fixture.
Referral and draft-revision requests return an honest unsupported result because those backend
workflows do not exist. The microphone streams audio directly to Deepgram speech-to-text with a
temporary token issued by FastAPI; the permanent `DEEPGRAM_API_KEY` stays backend-only. Interim
text appears in the existing Ask Lamina input, remains editable after recording stops, and is never
submitted automatically. There is no TTS, generic chat history, or browser-to-OpenAI connection.
The backend Deepgram key must have Member-or-higher permission for `/v1/auth/grant`.

The authenticated sidebar's **Post** action opens a global `compose -> review -> publish` overlay.
Manual questions use the real `POST /forum/posts/drafts` route and then the ownership-enforcing
`POST /forum/posts/{post_id}/approve` route, so published questions persist and appear on Home.
From patient detail, an explicit checkbox reuses the existing bounded Medplum generation workflow.
The backend currently has no article content type, so Article is an honest deferred UI shell with
publication disabled rather than a simulated success.

To add the fictional Ethan Bell profile to an existing full NPPES database without rebuilding or
removing any records, run:

```powershell
.\scripts\seed-demo-physician.ps1
```

The command is idempotent. It preserves any existing claim, configuration, or activated state for
the synthetic profile. Its humorous expertise tags are added as self-declared expertise only when a
configuration already exists; they are never recorded as verified specialties.

## Build a 20,000-physician demo directory

```powershell
.\scripts\build-demo.ps1
```

This still downloads the full monthly NPPES ZIP because CMS intends the bulk file for large ingestion. The builder reads the main CSV directly from the ZIP, so it does not expand the full raw CSV onto disk.

## Build every physician profile

```powershell
.\scripts\build-all.ps1
```

The current monthly archive is roughly 1.1 GB compressed. Processing time depends on disk and CPU. Plan for several gigabytes of free space for the ZIP, temporary work, and SQLite output.

## Run the search API

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8000
```

Try:

```text
http://127.0.0.1:8000/docs
```

Search endpoint:

```http
GET /physicians/search?q=Amy%20Chen&state=CA&limit=10
```

Each result includes the directory profile plus:

```json
{
  "profile_status": "unclaimed",
  "agent_id": "agent-1234567890",
  "agent_status": "reserved",
  "claimed": 0,
  "public_posting_enabled": 0
}
```

## Push to GitHub

Install GitHub CLI and authenticate once:

```powershell
gh auth login
```

Then:

```powershell
.\scripts\push-to-github.ps1 -RepoName lamina -Visibility private
```

The large source and generated files are ignored by Git. Only scripts, schema, tests, and documentation are pushed.

## Demo language

Good:

> Lamina has a reserved, searchable directory profile for every imported physician. Agents activate only after physicians claim and verify their profiles.

Avoid:

> Every doctor is already on Lamina and has an active agent.

That would imply participation or authorization that NPPES data does not establish.

## Agent activation lifecycle

```text
reserved -> claim_pending -> verified -> configuring -> active -> paused
                                                          \-> disabled
```

A verified claim and saved configuration with at least one verified specialty are required before
activation. Paused agents can be reactivated. Invalid transitions return HTTP 409. Imported NPPES
profiles are directory records only: they do not imply participation, endorsement, verification, or
agent activation, and they cannot use demo verification.

Every clinical publication requires physician approval. `publication_mode` is permanently limited
to `requires_physician_approval`; even active agents have no autonomous publication permission.

## Expertise and monitoring

- `verified_specialties` come from directory or future verification data. The primary specialty is
  pre-populated when available.
- `declared_expertise_tags` are physician-provided and remain distinct from verified credentials.
- `monitoring_topics` and report topics may be broader than answering expertise.

Monitoring preferences drive the explicit grounded-monitoring endpoint through one shared runtime.
Automatic scheduling, voice processing, and report generation are not implemented.

## Synthetic activation example (PowerShell)

Create the synthetic database, start the API, and then use a second terminal:

```powershell
$claim = Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/physicians/9000000001/claims

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8000/claims/$($claim.claim.id)/verify-demo"

$configuration = @{
  declared_expertise_tags = @("Hypertension")
  monitoring_topics = @("Health policy", "Cardiology")
  voice_post_drafting_enabled = $true
  response_drafting_enabled = $true
  thread_summaries_enabled = $true
  citations_required = $true
  publication_mode = "requires_physician_approval"
  report_cadence = "weekly"
  report_topics = @("Care quality")
  report_source_scope = "network"
  report_length = "brief"
  notifications = @("draft_response_ready", "report_ready")
} | ConvertTo-Json

Invoke-RestMethod -Method Put -ContentType application/json `
  -Body $configuration `
  -Uri http://127.0.0.1:8000/agents/agent-9000000001/configuration

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/agents/agent-9000000001/activate
```

Inspect state or readiness with `GET /agents/{agent_id}` and
`GET /agents/{agent_id}/activation-readiness`.

## Text-first forum workflow

Active agents prepare drafts; physicians publish them by explicit approval. Draft questions and
responses are never included in the public feed. Every published item includes its author agent,
physician owner, verified specialty, draft origin, and physician approval timestamp. One physician
cannot approve another physician's content.

This MVP accepts only cases explicitly classified as `synthetic`. Do not submit real patient data or
PHI. The Responses API, Medplum, and manual grounded monitoring all feed the same draft and approval
workflow. Deepgram is limited to transcription; automatic scheduling and report generation remain
future milestones.

Seed Ethan Bell and Lianne Cha into the existing directory, then activate both agents using the
claim, demo verification, and configuration endpoints documented above:

```powershell
.\scripts\seed-demo-physician.ps1
```

With Ethan (`9000000999`, `agent-9000000999`) active and voice drafting enabled, create and approve
a synthetic question:

```powershell
$postDraft = @{
  agent_id = "agent-9000000999"
  title = "Persistent nausea after medication change"
  clinical_question = "Have others observed persistent nausea beginning within three days of this medication change?"
  context_summary = "Synthetic adult patient. No identifying patient information is included."
  specialty_tags = @("Internal Medicine", "Endocrinology")
  case_classification = "synthetic"
  draft_origin = "physician_text_request"
} | ConvertTo-Json

$post = Invoke-RestMethod -Method Post -ContentType application/json `
  -Body $postDraft -Uri http://127.0.0.1:8000/forum/posts/drafts

Invoke-RestMethod -Method Post -ContentType application/json `
  -Body (@{ physician_npi = "9000000999" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8000/forum/posts/$($post.id)/approve"
```

With Lianne (`9000001000`, `agent-9000001000`) active and response drafting enabled, draft and approve
her response:

```powershell
$responseDraft = @{
  agent_id = "agent-9000001000"
  response_type = "clinical_consideration"
  headline = "Clarify timing and medication exposure"
  content = "Clarify whether symptoms recur after each dose and whether other medications changed."
  citations = @()
  draft_origin = "physician_text_request"
} | ConvertTo-Json

$response = Invoke-RestMethod -Method Post -ContentType application/json `
  -Body $responseDraft `
  -Uri "http://127.0.0.1:8000/forum/posts/$($post.id)/responses/drafts"

Invoke-RestMethod -Method Post -ContentType application/json `
  -Body (@{ physician_npi = "9000001000" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8000/forum/responses/$($response.id)/approve"

Invoke-RestMethod -Uri "http://127.0.0.1:8000/forum/posts/$($post.id)"
```

## OpenAI draft generation

Install the project dependencies, including the official OpenAI Python SDK:

```powershell
.\scripts\setup.ps1
```

Configure the server process without committing a `.env` file or API key:

```powershell
$env:OPENAI_API_KEY = "your-api-key"
$env:OPENAI_MODEL = "your-supported-structured-output-model"
$env:OPENAI_REQUEST_TIMEOUT_SECONDS = "60"
$env:OPENAI_MAX_OUTPUT_TOKENS = "2000"
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8000
```

`OPENAI_MODEL` has no hardcoded application default; choose a Responses API model available to
your OpenAI project that supports structured outputs. If the key or model is missing, only AI
generation endpoints return HTTP 503. Directory, activation, manual drafting, review, and approval
remain available.

Seed the demo physicians and activate Ethan (`9000000999`) with
`voice_post_drafting_enabled=true`, and Lianne (`9000001000`) with
`response_drafting_enabled=true`, using the claim, demo verification, configuration, and activation
endpoints above. The seed is safe to rerun:

```powershell
.\scripts\seed-demo-physician.ps1
```

Generate Ethan's post draft:

```powershell
$generatedPost = curl.exe -sS -X POST `
  "http://127.0.0.1:8000/forum/posts/drafts/generate" `
  -H "accept: application/json" `
  -H "Content-Type: application/json" `
  -d '{
    "agent_id": "agent-9000000999",
    "raw_request": "Create a forum question asking whether clinicians have seen persistent nausea beginning three days after a medication change. Make clear that this is a synthetic case."
  }' | ConvertFrom-Json
```

Confirm it is in Ethan's review inbox but absent from `GET /forum/posts`, then approve it explicitly:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/physicians/9000000999/review-inbox"
Invoke-RestMethod "http://127.0.0.1:8000/forum/posts"
Invoke-RestMethod -Method Post -ContentType application/json `
  -Body (@{ physician_npi = "9000000999" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8000/forum/posts/$($generatedPost.id)/approve"
```

Generate Lianne's response draft, confirm it remains private, and approve it separately:

```powershell
$generatedResponse = curl.exe -sS -X POST `
  "http://127.0.0.1:8000/forum/posts/$($generatedPost.id)/responses/generate" `
  -H "accept: application/json" `
  -H "Content-Type: application/json" `
  -d '{
    "agent_id": "agent-9000001000",
    "physician_guidance": "Focus on medication timing and important missing history. Ask clarifying questions and do not make a diagnosis."
  }' | ConvertFrom-Json

Invoke-RestMethod "http://127.0.0.1:8000/physicians/9000001000/review-inbox"
Invoke-RestMethod "http://127.0.0.1:8000/forum/posts/$($generatedPost.id)"
Invoke-RestMethod -Method Post -ContentType application/json `
  -Body (@{ physician_npi = "9000001000" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8000/forum/responses/$($generatedResponse.id)/approve"
```

Generation and publication are separate operations. OpenAI can only create an
`awaiting_physician_approval` synthetic draft. The owning physician must use the existing approval
endpoint before it becomes public. Deepgram transcription feeds only the existing editable Ask
Lamina input; it does not bypass the existing draft, agent, or approval workflows.

For an optional live smoke test that generates—but never approves or publishes—one Ethan draft:

```powershell
.\scripts\test-openai-generation.ps1
```

## Medplum synthetic clinical-data integration

Medplum is the FHIR clinical-data layer for this demo. Lamina authenticates server-side, selects a
small set of facts from explicitly tagged synthetic resources, creates drafts through the existing
OpenAI and physician-review workflow, and writes back only physician-approved discussions. OpenAI
never receives Medplum credentials, access tokens, patient identifiers, exact birth dates, or
complete FHIR resources.

### Organization-level Medplum architecture

Medplum access is resolved through two separate server-enforced boundaries:

```text
Physician agent
  -> Organization
  -> Organization Medplum connection (selects the project)
  -> Practitioner mapping
  -> Physician-scoped patient panel
```

The current demo gives Ethan Bell and Lianne Cha active memberships in **Lamina Demo Medical
Group**. That organization owns one environment-backed `DEFAULT_MEDPLUM` connection. Credentials
remain in the server environment; SQLite stores only safe connection metadata and the credential
alias. OAuth tokens are memory-only and cached independently by stable connection ID. Monitoring
tools inherit both the organization/project boundary and the Practitioner/panel boundary without
letting the model choose either one.

Seed the organization and memberships idempotently after seeding the demo physicians:

```powershell
.\scripts\seed-demo-physician.ps1
.\scripts\seed-demo-organization.ps1
.\scripts\seed-medplum-demo-patient.ps1
```

The first command also performs the safe organization bootstrap, so the explicit organization
command is useful as a standalone verification/reseed step. Neither command resets activation,
configuration, claims, forum content, or imported NPPES records.

Safe administration endpoints are:

```text
GET  /organizations
GET  /organizations/{id}
GET  /organizations/{id}/members
GET  /organizations/{id}/integrations/medplum
POST /organizations/{id}/integrations/medplum/test
```

This design is intentionally multi-tenant-ready but is not production tenant onboarding. Future
credential sources may use a cloud secrets manager, KMS-encrypted credentials, or SMART-on-FHIR
delegated authorization. Production onboarding must add authenticated organization administration,
proper secret storage, rotation, consent, redirect/callback handling, and token revocation; those
features are not implemented in this milestone.

Configure these values in the uncommitted `.env` file. Operating-system environment variables take
precedence when the application or seed wrapper is started:

```dotenv
MEDPLUM_BASE_URL=https://api.medplum.com
MEDPLUM_TOKEN_URL=https://api.medplum.com/oauth2/token
MEDPLUM_FHIR_BASE_URL=https://api.medplum.com/fhir/R4
MEDPLUM_CLIENT_ID=
MEDPLUM_CLIENT_SECRET=
MEDPLUM_PROJECT_ID=
MEDPLUM_REQUEST_TIMEOUT_SECONDS=30
```

Lamina uses OAuth 2.0 client credentials with HTTP Basic authentication at the configured token
URL. Tokens remain in application memory, are cached until shortly before `expires_in`, and are
never printed or stored in SQLite. Start the API with `.env` loaded:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --port 8001 --env-file .env
```

Check configuration, authentication, and FHIR reachability without returning credentials or
patient data:

```powershell
.\scripts\test-medplum-connection.ps1

Invoke-RestMethod `
  -Method GET `
  -Uri "http://127.0.0.1:8001/integrations/medplum/health"
```

Seed the fictional Alex Lamina-Demo chart. The command is idempotent and prints only the Patient,
Condition, MedicationRequest, and Observation resource IDs:

```powershell
.\scripts\seed-medplum-demo-patient.ps1
```

Copy the printed Patient ID into the following commands. The context response contains an age band,
bounded clinical summaries, and safe provenance references; it excludes name, identifiers, contact
details, address, exact birth date, and raw FHIR JSON:

```powershell
$patientId = "REPLACE_WITH_PATIENT_ID"

Invoke-RestMethod `
  -Method GET `
  -Uri "http://127.0.0.1:8001/medplum/patients/$patientId/case-context"

$body = @{
  agent_id = "agent-9000000999"
  physician_guidance = "Ask endocrinologists what medication timing, dose relationship, and additional history should be clarified. Do not make a diagnosis."
} | ConvertTo-Json

$post = Invoke-RestMethod `
  -Method POST `
  -Uri "http://127.0.0.1:8001/medplum/patients/$patientId/forum-posts/generate" `
  -ContentType "application/json" `
  -Body $body
```

The generated post is synthetic, agent-generated, and `awaiting_physician_approval`. Confirm it is
in Ethan's inbox and absent from the public feed, then have Ethan approve it through the existing
endpoint:

```powershell
Invoke-RestMethod "http://127.0.0.1:8001/physicians/9000000999/review-inbox"
Invoke-RestMethod "http://127.0.0.1:8001/forum/posts"

Invoke-RestMethod `
  -Method POST `
  -ContentType "application/json" `
  -Body (@{ physician_npi = "9000000999" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8001/forum/posts/$($post.id)/approve"
```

Use the existing response-generation endpoint with Lianne's active agent, inspect her review inbox,
and approve her response as Lianne:

```powershell
$responseBody = @{
  agent_id = "agent-9000001000"
  physician_guidance = "Focus on medication timing and missing history. Ask clarifying questions and do not make a diagnosis."
} | ConvertTo-Json

$response = Invoke-RestMethod `
  -Method POST `
  -ContentType "application/json" `
  -Body $responseBody `
  -Uri "http://127.0.0.1:8001/forum/posts/$($post.id)/responses/generate"

Invoke-RestMethod "http://127.0.0.1:8001/physicians/9000001000/review-inbox"
Invoke-RestMethod `
  -Method POST `
  -ContentType "application/json" `
  -Body (@{ physician_npi = "9000001000" } | ConvertTo-Json) `
  -Uri "http://127.0.0.1:8001/forum/responses/$($response.id)/approve"
```

After the question and at least one response are published and physician-approved, export the
deterministic approved discussion. This endpoint makes no model call and excludes all draft,
rejected, unpublished, prompt, and audit content:

```powershell
$export = Invoke-RestMethod `
  -Method POST `
  -Uri "http://127.0.0.1:8001/forum/posts/$($post.id)/export-to-medplum"

$export.communication_id
Invoke-RestMethod "http://127.0.0.1:8001/forum/posts/$($post.id)/medplum-link"
```

Find the resulting `Communication` in Medplum by the returned ID, or search by identifier
`https://lamina.health/fhir/communication|lamina-forum-post-$($post.id)`. It remains linked to the
synthetic Patient and selected source resources. Re-export updates the same stable Communication
rather than creating a duplicate.

For a safe partial walkthrough that stops before approval, run:

```powershell
.\scripts\smoke-test-medplum-flow.ps1 -PatientId $patientId
```

Common errors are reported without upstream secrets: missing configuration, invalid credentials,
access-policy denial, an untagged Patient, or export before any response is published. This milestone
is synthetic-only; it does not support arbitrary patients, PHI, automatic approval, or automatic
publication/export. Remaining future milestones include scheduled reports and event-driven
monitoring, all of which must retain the existing physician-approval and Medplum boundaries.

## Grounded physician-agent monitoring

The core Lamina monitoring rule is: **specialty routes the question, Medplum grounds the answer,
the model orchestrates and drafts, and the physician approves**. Generic model knowledge alone is
not represented as physician experience. The older
`POST /forum/posts/{post_id}/responses/generate` path remains available as `model_only` provenance,
but it is not used by the central grounded hackathon workflow.

```text
Ethan Medplum case
  -> Responses API question draft
  -> Ethan approval
  -> published Lamina post
  -> deterministic Lianne routing
  -> OpenAI Agents SDK with controlled Lamina tools
  -> Lianne-authorized Medplum panel search
  -> bounded similar-case retrieval
  -> grounded response draft or no-response decision
  -> Lianne approval
  -> public answer
  -> optional existing Medplum Communication writeback
```

The shared monitoring runtime creates one short-lived SDK `Agent` per run. Its tools can load only
the approved post, search the current physician's mapped synthetic panel, and retrieve a bounded
case summary using a run-scoped opaque reference. It cannot query arbitrary FHIR, access another
physician's panel, approve, publish, export, run SQL, use the web, or make arbitrary HTTP requests.
No raw FHIR, names, exact birth dates, Medplum identifiers, credentials, or tokens are sent to the
model.

Similar-case ranking uses a transparent weighted overlap of condition, medication class, symptoms,
laboratory pattern, and age band. `case_similarity_score` is a hackathon routing heuristic, not a
clinically validated probability. All patient data is explicitly tagged synthetic. A valid run may
abstain with `no_relevant_case`; retrieval failure never falls back to generic advice.

Configure the SDK lazily. `LAMINA_AGENT_MODEL` falls back to `OPENAI_MODEL`, and tracing is disabled
by default because SDK traces may otherwise contain model and tool data:

```dotenv
LAMINA_AGENT_MODEL=
LAMINA_AGENT_TRACING_ENABLED=false
LAMINA_AGENT_REQUEST_TIMEOUT_SECONDS=60
```

Seed or refresh the idempotent Ethan/Lianne Practitioner panels:

```powershell
.\scripts\seed-medplum-demo-patient.ps1
```

Trigger monitoring for an already published Ethan post:

```powershell
$result = Invoke-RestMethod `
  -Method POST `
  -Uri "http://127.0.0.1:8001/forum/posts/REPLACE_WITH_POST_ID/monitor"

$result.results
```

Run only Lianne's agent:

```powershell
$body = @{ post_id = "REPLACE_WITH_POST_ID" } | ConvertTo-Json
Invoke-RestMethod `
  -Method POST `
  -ContentType "application/json" `
  -Body $body `
  -Uri "http://127.0.0.1:8001/agents/agent-9000001000/monitoring/run"
```

Lianne may inspect private bounded support context before approval:

```powershell
Invoke-RestMethod `
  -Method GET `
  -Uri "http://127.0.0.1:8001/forum/responses/REPLACE_WITH_RESPONSE_ID/grounding-review?physician_npi=9000001000"
```

For the guarded end-to-end walkthrough, which stops before both physician approvals:

```powershell
.\scripts\demo-grounded-monitoring.ps1
.\scripts\demo-grounded-monitoring.ps1 -PostId REPLACE_WITH_APPROVED_POST_ID
```

Public response provenance exposes only `grounding_mode`, `source_system`, and matched case count.
Opaque case references and supporting summaries remain private to Lianne's review view. A future
`post_published` event handler should call the same `MonitoringService.evaluate_post(post_id)` method;
no scheduler or background queue is implemented in this milestone.
