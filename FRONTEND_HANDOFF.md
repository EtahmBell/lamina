# Lamina frontend handoff

The frontend is a React 19, TypeScript, Vite 8 interface to the existing Lamina backend. FastAPI,
Medplum, and the OpenAI workflows remain authoritative. The browser does not call Medplum or
OpenAI directly and never substitutes mock clinical data when a backend request fails.

## Deployment

The hackathon topology is:

```text
Vercel frontend
  -> configurable HTTPS Lamina API base URL
  -> Cloudflare Quick Tunnel
  -> FastAPI at http://127.0.0.1:8001
  -> Medplum / OpenAI Responses API / OpenAI Agents SDK
```

`VITE_API_BASE_URL` is the frontend's only API configuration. It is read at build time.

### Local frontend to local backend

Start FastAPI from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app `
  --host 127.0.0.1 --port 8001 --env-file .env
```

Then start Vite:

```powershell
Set-Location .\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

The local value is:

```text
VITE_API_BASE_URL=http://127.0.0.1:8001
```

### Vercel frontend to tunneled local backend

Run `scripts/start-cloudflare-tunnel.ps1`, copy its current HTTPS URL, and set this exact Vercel
Production environment variable:

```text
VITE_API_BASE_URL=https://your-current-tunnel-host.trycloudflare.com
```

Redeploy after changing it. Never use localhost in a Vercel build: it would refer to the visitor's
computer. Never put `OPENAI_API_KEY`, Medplum credentials, bearer tokens, or other backend secrets
in Vercel or any `VITE_*` variable. FastAPI explicitly permits the deployed origin
`https://frontend-nu-weld-79.vercel.app` and the two local Vite origins without wildcard CORS.

## Product structure

The active application has four pages:

- **My Patients** — default landing page, authorized synthetic Medplum panel, bounded patient
  detail, Ask Lamina drafting, Ethan approval, and grounded monitoring.
- **Network** — published backend forum threads plus live NPPES physician directory search.
- **Review Inbox** — Lianne's real pending grounded response drafts, private evidence review, and
  approval action.
- **Profile** — read-only backend physician, agent, organization, configuration, and safe Medplum
  connection state.

Reusable layout, cards, badges, typography, colors, and responsive styling were retained. The old
static feed, article graph, generic assistant, fake publication center, fake connection mutations,
fake setup, fake signup, and timer-based success flows were removed from the active source tree.

There is one AI architecture:

```text
browser -> Lamina FastAPI -> bounded Medplum context -> draft/retrieval workflow
```

The typed API client is `frontend/src/api/client.ts`. It contains the only browser `fetch` call.

## Demo session

Production authentication is not implemented. `DemoSessionProvider` owns the controlled browser
session, while `frontend/src/session.ts` centrally defines the only two selectable identities:

| Role | NPI | Agent ID |
|---|---|---|
| Ethan Bell, MD, MS | `9000000999` | `agent-9000000999` |
| Lianne Cha, MD | `9000001000` | `agent-9000001000` |

Names, credentials, specialties, organization, lifecycle state, configuration, patients, clinical
facts, posts, responses, and review state are loaded from FastAPI. Components do not repeat those
identity constants. The selected NPI is persisted as `lamina_demo_session_npi` only after it is
validated against this allowlist.

The sign-in screen is explicitly a synthetic physician selector with no password fields or claim
of production security. **Switch physician / Sign out** clears the selected identity and all
patient/post UI navigation keys, then returns to the selector. It does not mutate any backend
record, agent lifecycle state, forum content, or Medplum data.

## Safe patient APIs

The browser uses two physician-scoped routes. It never receives a Medplum Patient ID or a FHIR
resource reference.

### List authorized patients

```http
GET /physicians/{npi}/patients
```

The server resolves the synthetic physician, organization, organization Medplum connection,
Practitioner mapping, and authorized panel. It returns only:

```json
{
  "physician_npi": "9000000999",
  "patients": [
    {
      "patient_ref": "case-opaque-value",
      "display_name": "Synthetic Patient A",
      "synthetic": true,
      "age_band": "40–49",
      "summary": "Bounded facts returned by Lamina"
    }
  ],
  "count": 1
}
```

`patient_ref` is an opaque Lamina reference derived for that physician agent. Resolution is
server-side and limited to the physician's current authorized panel.

### Load bounded patient detail

```http
GET /physicians/{npi}/patients/{patient_ref}/case-context
```

The response contains only `patient_ref`, `display_name`, `synthetic`, `age_band`, and bounded
conditions, medications, and observations. It excludes `patient_id`, `source_resource_refs`, raw
FHIR, names, exact birth dates, addresses, and contact details. The older
`GET /medplum/patients/{patient_id}/case-context` remains an internal provenance/debugging route and
must not be used by public frontend components.

## Ask Lamina and physician approval

Patient detail and Network pages include one reusable, understated **Ask Lamina** composer. It is a
contextual command surface, not a chat sidebar and not a second agent architecture. It has no
conversation history, avatar, floating orb, or autonomous clinical-answer path.

On a patient detail page, the composer receives the current backend-derived physician NPI and the
selected physician-scoped `patient_ref`. Supported natural-language question requests call the
same endpoint documented below and render the returned approval-required draft. Referral language
is recognized but returns an explicit unsupported message because referral persistence and
approval endpoints do not exist.

On Network, the composer calls the existing published forum route with its bounded `q` filter:

```http
GET /forum/posts?status=published&q=SGLT2%20inhibitors
```

This searches titles, clinical questions, context summaries, and specialty tags for published
records only. It does not call a model or expose drafts. Review and Profile hide the composer
because there is no safe backend revision/explanation action to invoke there.

The microphone control is disabled with visible explanatory copy. Deepgram/backend transcription
is not implemented, so the frontend does not request microphone access or fabricate listening and
transcription states. A future transcript must enter the same patient/network request handler.

The patient page posts physician guidance to:

```http
POST /physicians/{npi}/patients/{patient_ref}/forum-posts/generate
Content-Type: application/json

{ "physician_guidance": "I haven't seen this pattern before. Has anyone seen something similar?" }
```

The server infers the physician's agent and resolves the opaque patient reference within that
physician's panel. It reuses the existing bounded Medplum and Responses API post-generation
service. The response deliberately omits the internal Medplum link.

The frontend renders the returned `title`, `clinical_question`, `context_summary`,
`specialty_tags`, status, and provenance. Publication requires the real ownership-enforcing route:

```http
POST /forum/posts/{post_id}/approve

{ "physician_npi": "9000000999" }
```

After approval, the UI uses returned backend state and the published thread. It never toggles a
local publication flag as a substitute for approval.

## Network and NPPES directory

The Network page uses:

```http
GET /forum/posts?status=published
GET /forum/posts/{post_id}
GET /physicians/search?q={query}&state={optional_state}&limit=20
GET /physicians/{npi}
```

Only actual published posts and responses are shown. There are no engagement counters or static
articles. Directory results distinguish NPPES-backed unclaimed/reserved profiles from active
synthetic demo physicians; directory presence never implies Lamina participation.

## Grounded specialist monitoring and review

From an approved Medplum-grounded post, My Patients calls:

```http
POST /forum/posts/{post_id}/monitor
```

The UI renders the actual `candidate`, `physician_name`, `outcome`, `matched_case_count`, and
`response_id`. The backend Agents SDK remains responsible for panel-scoped retrieval and drafting.
No response is fabricated if the backend abstains or fails.

The selected physician's Review page uses their own NPI for every inbox, grounding-review, and
approval call. During the guided flow, Lianne's calls are:

```http
GET  /physicians/9000001000/review-inbox
GET  /forum/responses/{response_id}/grounding-review?physician_npi=9000001000
POST /forum/responses/{response_id}/approve

{ "physician_npi": "9000001000" }
```

The inbox and grounding review are private views. Approval is enforced by the existing backend
ownership and lifecycle rules. Public forum provenance exposes only `grounding_mode`,
`source_system`, and `matched_case_count`; it never exposes patient/resource IDs, raw FHIR
references, source case details, or opaque case refs.

## Loading, empty, and error behavior

All loading indicators correspond to an active request. Empty panels display honest states such as
"No patients are available" or "No pending reviews." Backend, Medplum, OpenAI, generation,
approval, and monitoring errors are shown as concise failures with retry where useful. No failure
path falls back to mock data or reports success after a timer.

The selected safe patient reference and most recent post are stored in browser local storage only
to preserve navigation context. Those keys are scoped by physician NPI and cleared on sign-out.
All clinical and workflow truth is reloaded from FastAPI.

## Intentional static values

The remaining product-level demo constants are:

- Ethan's and Lianne's NPIs and agent IDs in one synthetic-session allowlist.
- Navigation labels, UI copy, local-storage keys, and other visual configuration.

There are no hardcoded patients, clinical facts, posts, responses, articles, recommendations,
engagement statistics, resource IDs, Cloudflare URLs, OpenAI settings, or Medplum credentials.

## Validation

Backend:

```powershell
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\python.exe -m ruff check .
```

Frontend:

```powershell
Set-Location .\frontend
npm run lint
$env:VITE_API_BASE_URL = 'https://example.trycloudflare.com'
npm run build
```

There is currently no frontend test script in `package.json`.

## Demo walkthrough

Lamina supports two database-backed presentation modes. The frontend uses the same FastAPI routes
in both and never substitutes local arrays:

| Mode | Command | Starting state |
|---|---|---|
| Live workflow (canonical) | `.\scripts\reset-demo.ps1` | Zero Ethan/Lianne posts and responses |
| Populated showcase | `.\scripts\seed-showcase-content.ps1` | Four synthetic discussions and two synthetic responses |

The showcase seed is idempotent and non-destructive. It requires the two synthetic demo agents to
be active, inserts only stable showcase IDs, and preserves the full NPPES directory and all
physician, organization, activation, configuration, and Medplum state. Run the reset command to
switch cleanly back to live workflow mode.

Before recording, from the repository root:

```powershell
.\scripts\reset-demo.ps1
.\scripts\verify-demo-ready.ps1
```

The reset makes a selective application-row backup under `data/processed/backups/`; it never copies
or modifies the NPPES directory or the preserved physician, organization, activation, and Medplum
mapping state.

1. Open the app and confirm the Network has zero discussions.
2. Select **Ethan Bell, MD, MS** and open his authorized synthetic patient.
3. Review bounded Medplum context, enter the question, and generate the real draft.
4. Approve and publish as Ethan; Network now contains exactly that one post.
5. Run **Search physician network** and confirm Lianne is found with one authorized similar case.
6. Use **Switch physician / Sign out**, then select **Lianne Cha, MD**.
7. Open **Review**, inspect the real persisted Medplum-grounded response, and approve it.
8. Sign out, sign back in as Ethan, and open the Network thread.
9. Confirm Ethan's question and Lianne's approved response persist after refresh.
10. Search for a real physician and confirm the NPPES result remains unclaimed/reserved.

## Capabilities not represented

- Production authentication is deferred; the current two-profile selector is explicit demo state.
- Deepgram voice capture is not implemented, so Ask Lamina is typed only.
- Connection/referral persistence has no backend route and is therefore omitted.
- Post editing is omitted because no safe existing edit endpoint is available.
- Medplum export remains a backend capability but is not exposed in this simplified primary flow.
- Scheduled/background monitoring and network intelligence reports remain future work.
- Only explicitly tagged synthetic patient data is supported.
