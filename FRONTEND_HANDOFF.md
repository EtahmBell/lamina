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

The primary navigation is **Home**, **My Patients**, **Publication Center**, **Agent Setup**,
**Connections**, and **Physicians**. The signed-in physician identity opens the backend-backed
profile. Home blends real published FastAPI discussions above five isolated fictional showcase
items. Physicians keeps the live NPPES search separate from fictional showcase profiles.

`frontend/src/demo/showcaseFeed.ts` is the single source of fictional physicians, discussions,
reports, locations, proximity, and social counts. `frontend/src/demo/demoConnections.ts` stores
showcase-only connections under `lamina_demo_connections`, scoped by signed-in NPI. Neither module
is used by approval, monitoring, Medplum, referral, or review workflows.

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

Showcase connections persist in browser local storage under `lamina_demo_connections`, keyed by
the current demo physician NPI. To clear only this demo social state from browser developer tools:

```js
localStorage.removeItem('lamina_demo_connections')
```

The database reset intentionally does not manipulate browser storage.

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

Desktop pages use one persistent right-hand **Ask Lamina** command panel. It changes context for
Home, My Patients, patient detail, Publication Center, Agent Setup, Connections, Physicians, and
profiles. It is not a generic medical chatbot and has no conversation history, avatar, floating
orb, or autonomous clinical-answer path.

On a patient detail page, the composer receives the current backend-derived physician NPI and the
selected physician-scoped `patient_ref`. Supported natural-language question requests call the
same endpoint documented below and render the returned approval-required draft. Referral language
is recognized but returns an explicit unsupported message because referral persistence and
approval endpoints do not exist.

On Home, supported search requests call the existing published forum route with its bounded `q`
filter and also filter the isolated showcase fixtures locally:

```http
GET /forum/posts?status=published&q=SGLT2%20inhibitors
```

This searches titles, clinical questions, context summaries, and specialty tags for published
records only. It does not call a model or expose drafts. Other screens provide bounded navigation,
filter, or explanatory actions and return an honest unsupported result when no workflow exists.

The existing Ask Lamina microphone uses Deepgram only for live speech-to-text. FastAPI exchanges
the backend-only `DEEPGRAM_API_KEY` for a 30-second token through
`POST /integrations/deepgram/token`; the permanent key is never returned to or configured in the
browser. The browser opens `wss://api.deepgram.com/v1/listen` with `nova-3-medical`, `en-US`, smart
formatting, and interim results. Interim text appears in the existing input, stopping leaves an
editable final transcript, and voice never submits automatically or creates another agent path.
The configured Deepgram key must have Member-or-higher permission to call `/v1/auth/grant`.

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

## Global Post composer

The rust **Post** button is available below the primary navigation and above the signed-in
physician identity on every authenticated screen. It opens an overlay without changing the
current page and always derives authorship from `CurrentPhysician`.

The Question flow is `compose -> review -> publish`. A question without patient context creates a
real manual draft through:

```http
POST /forum/posts/drafts
POST /forum/posts/{post_id}/approve
```

The first request persists the physician-authored title, question, context summary, topics, and
synthetic case classification. The second remains the authoritative physician approval step. On
success the browser opens the returned published post on Home; a refresh reads it back from
FastAPI rather than browser state.

When the composer is opened from a patient detail page, it offers an explicit **Use current
patient context** checkbox. Selecting it routes generation through the existing
physician-scoped, opaque `patient_ref` endpoint described above. It never sends Medplum IDs or raw
FHIR from the browser and still requires the review screen plus the real approval route.

The backend has no article content type. Article mode therefore provides a visible manual-composer
shell marked **Backend support required**, with publication disabled as **Article publishing
deferred**. It does not create a discussion, call AI, or simulate a successful article.

Cancel, the close control, and Escape close the overlay without publishing. No partial manual
question is persisted before **Publish**; a bounded patient-assisted draft is created only when the
physician explicitly selects patient context and continues to review, and remains unpublished
unless approved.

## Home, connections, and physician directory

Home uses the forum routes, while Physicians uses the NPPES routes:

```http
GET /forum/posts?status=published
GET /forum/posts/{post_id}
GET /physicians/search?q={query}&state={optional_state}&limit=20
GET /physicians/{npi}
```

Real posts display only real response counts and always appear before showcase items. Fictional
showcase posts are labeled in the UI and may display static likes, responses, and views from the
single fixture. They have no post IDs recognized by FastAPI and cannot enter clinical workflows.
NPPES results never receive showcase activity, proximity, or connection controls.

Agent Setup saves monitoring topics, declared expertise, response-drafting enablement, report
cadence, report topics, scope, length, notifications, and approval policy through the existing
`PUT /agents/{agent_id}/configuration` route. Activity frequency is explicitly a demo scheduling
preference in `lamina_demo_activity_frequency`; only its off/on drafting state is persisted to the
backend because no scheduler exists. Report cadence (`none`, `weekly`, `monthly`) is backend state.

## Grounded specialist monitoring and review

From an approved Medplum-grounded post, My Patients calls:

```http
POST /forum/posts/{post_id}/monitor
```

The UI renders the actual `candidate`, `physician_name`, `outcome`, `matched_case_count`, and
`response_id`. The backend Agents SDK remains responsible for panel-scoped retrieval and drafting.
No response is fabricated if the backend abstains or fails.

The selected physician's Publication Center uses their own NPI for every inbox, grounding-review,
and approval call. During the guided flow, Lianne's calls are:

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

1. Open Home and review the five fictional showcase feed items.
2. Select **Ethan Bell, MD, MS** and open his authorized synthetic patient.
3. Review bounded Medplum context, enter the question, and generate the real draft.
4. Approve and publish as Ethan; the real post appears above showcase content on Home.
5. Run **Search physician network** and confirm Lianne is found with one authorized similar case.
6. Use **Switch physician / Sign out**, then select **Lianne Cha, MD**.
7. Open **Publication Center**, inspect the real persisted Medplum-grounded response, and approve it.
8. Sign out, sign back in as Ethan, and open the Home thread.
9. Confirm Ethan's question and Lianne's approved response persist after refresh.
10. Search for a real physician and confirm the NPPES result remains unclaimed/reserved.

## Capabilities not represented

- Production authentication is deferred; the current two-profile selector is explicit demo state.
- Deepgram is speech-to-text only; it does not provide TTS or an autonomous voice-agent path.
- Showcase connections are demo-local browser state only; referral persistence remains unsupported.
- Post editing is omitted because no safe existing edit endpoint is available.
- Medplum export remains a backend capability but is not exposed in this simplified primary flow.
- Scheduled/background monitoring and network intelligence reports remain future work.
- Only explicitly tagged synthetic patient data is supported.
