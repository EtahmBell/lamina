# Lamina frontend handoff

This is the frontend integration contract for the current hackathon backend. FastAPI routes and
Pydantic models are authoritative if this document and code ever diverge.

# Hackathon deployment

The demo uses this intentionally temporary topology:

```text
https://frontend-nu-weld-79.vercel.app/
        -> HTTPS Cloudflare Quick Tunnel
        -> http://127.0.0.1:8001 on Ethan's Windows laptop
```

The frontend is React 19, TypeScript, and Vite 8 in `frontend/`. Its only production browser
configuration is:

```text
VITE_API_BASE_URL=https://your-generated-subdomain.trycloudflare.com
```

Do not commit or hardcode the generated URL. Vite injects the value at build time, so every change
to `VITE_API_BASE_URL` requires a Vercel redeploy. OpenAI and Medplum credentials remain only in
the local backend `.env`; they must never be copied into Vercel or any `VITE_*` variable. The
tunnel exposes FastAPI HTTP routes, not the SQLite files themselves.

### Manual startup

From the repository root, start the two required processes in separate visible PowerShell windows.

Terminal 1 - local FastAPI:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app `
    --host 127.0.0.1 `
    --port 8001 `
    --env-file .env
```

Terminal 2 - Cloudflare Quick Tunnel:

```powershell
.\scripts\start-cloudflare-tunnel.ps1
```

The helper verifies `cloudflared --version`, checks the backend health endpoint, and then runs the
required visible command:

```powershell
cloudflared tunnel --url http://127.0.0.1:8001
```

Then complete these manual steps:

1. Copy the generated `https://*.trycloudflare.com` URL from Terminal 2.
2. Open the Vercel project settings for `https://frontend-nu-weld-79.vercel.app/`.
3. Set the Production environment variable `VITE_API_BASE_URL` to that URL, with no localhost
   fallback and no secret values.
4. Redeploy the frontend so Vite embeds the new value.
5. Keep both FastAPI and cloudflared running for the entire demo.
6. Run `.\scripts\verify-demo-ready.ps1` again and confirm all required checks pass.

`127.0.0.1` in a remote visitor's browser refers to that visitor's device, not Ethan's laptop.
The deployed frontend must therefore use the public Cloudflare HTTPS URL. Closing cloudflared
invalidates the Quick Tunnel endpoint; the next tunnel URL must be copied to Vercel and followed by
another redeploy. This is a Quick Tunnel only: it requires no Cloudflare account, DNS changes,
permanent tunnel credentials, or Windows service.

## 1. What Lamina is

Lamina is a physician-supervised agent network. Medplum is the clinical ground-truth/FHIR layer;
the OpenAI Responses API formats physician questions into structured post drafts; and the OpenAI
Agents SDK performs multi-step monitoring and grounded similar-case retrieval for physician agents.

AI creates drafts only. The owning physician approves and publishes. All current patient data and
participating demo physicians are synthetic.

> Specialty routes the question. Medplum grounds the answer. The model drafts. The physician approves.

## 2. Local backend

- API base: `http://127.0.0.1:8001`
- FastAPI docs: `http://127.0.0.1:8001/docs`
- Health: `http://127.0.0.1:8001/health`

From the repository root, with server-only settings in the uncommitted `.env`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app `
    --reload `
    --host 127.0.0.1 `
    --port 8001 `
    --env-file .env
```

```text
frontend/browser -> Lamina FastAPI -> OpenAI / Medplum
```

The browser must never call OpenAI or Medplum directly. Never put an OpenAI key, Medplum client
secret, or Medplum bearer token in frontend code or a browser-bundled environment variable.

### Local frontend

The merged frontend is React 19 with TypeScript, Vite 8, and Tailwind CSS 4. From `frontend/`:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

- Frontend dev URL: `http://localhost:5173`
- Browser-safe configuration: `VITE_API_BASE_URL=http://127.0.0.1:8001`
- Central API module: `frontend/src/api/client.ts`
- Integrated screen: **Clinical Demo** (the initial navigation selection)

No OpenAI or Medplum credential belongs in a `VITE_*` variable.

## 3. Demo identities

Both identities are fictional, synthetic demo physicians.

| Physician | NPI | Agent ID | Verified specialty |
|---|---|---|---|
| Ethan Bell, MD, MS | `9000000999` | `agent-9000000999` | Internal Medicine |
| Lianne Cha, MD | `9000001000` | `agent-9000001000` | Endocrinology |

## 4. Core end-to-end demo flow

1. Show Ethan's explicitly synthetic Medplum case.
2. Ethan asks a question about that case.
3. Lamina retrieves bounded Medplum context.
4. The Responses API creates a structured post draft.
5. Ethan sees **Awaiting physician approval**.
6. Ethan approves; the post becomes public.
7. The UI triggers Lamina monitoring.
8. Deterministic specialty/topic routing selects Lianne as a candidate.
9. The Agents SDK searches only Lianne's authorized synthetic Medplum panel.
10. Bounded similar cases are retrieved using run-scoped opaque case references.
11. A Medplum-grounded response draft is created, or the agent abstains.
12. Lianne sees the private grounding evidence and review state.
13. Lianne approves; the response becomes public.
14. The approved discussion can be exported to Ethan's synthetic Medplum chart.

Lianne's response is not generated merely because she is an endocrinologist. Specialty routes her
agent; retrieved cases from her authorized Medplum panel provide the clinical grounding.

## 5. Primary frontend screens

- Physician/agent header: identity, verified specialty, agent status.
- Patient case view: synthetic badge and bounded case facts.
- Ask network action: physician guidance and draft generation.
- Draft review card: clinical draft, provenance, approve/reject actions.
- Forum thread: published post and published responses only.
- Monitoring result card: candidate, outcome, count, and response link.
- Lianne review inbox/response review.
- Private grounding details and public grounding badge.
- Export-to-Medplum action and result.

The implemented workflow is in `frontend/src/components/DemoWorkflowPage.tsx`. The pre-existing
Home, Publication Center, Agent Setup, Agent Connections, assistant, profile, and signup prototypes
remain local mock experiences and are intentionally separate from the backend-backed Clinical Demo.

## 6. Required UI labels and states

| UI label | Backend source |
|---|---|
| Synthetic demo case | case `synthetic=true`; post `case_classification="synthetic"` |
| AI drafted | `provenance.drafted_by_agent`; `provenance.draft_origin="agent_generated"` |
| Awaiting physician approval | `status="awaiting_physician_approval"` |
| Physician approved | `provenance.physician_approved=true` and `approved_at` |
| Published | `status="published"` |
| Grounded in Medplum | response `provenance.grounding.source_system="medplum"` |
| Similar cases found: N | `provenance.grounding.matched_case_count` or monitoring result count |
| No relevant grounded case found | monitoring `outcome="no_relevant_case"` |
| Monitoring in progress | local request state while the monitor POST is pending |
| Monitoring complete | successful monitor response and its per-agent `outcome` |
| Exported to Medplum | export response `status` plus `exported_at` |

Workflow labels come from structured backend metadata. Do not insert review state, approval state,
or empty-citation bookkeeping into clinical prose.

## 7. Main API endpoints

All successful routes currently return HTTP `200`. Validation errors return `422` with FastAPI's
standard `detail` array. Error responses otherwise use `{ "detail": "..." }`.

| Method and path | Purpose and request | Key response fields | Frontend-relevant errors |
|---|---|---|---|
| `GET /physicians/search?q=...&state=CA&limit=10` | Search directory. `q` is required (2–120 chars); `state` and `limit` are optional. | `results`, `count`; result rows include physician and reserved-agent fields. | `422`; `503` if DB is unavailable. |
| `GET /agents/{agent_id}` | Load lifecycle, physician, configuration, and permissions. | `id`, `physician_npi`, `status`, `physician`, `claim`, `configuration`, `effective_permissions`, `activation_readiness`. | `404` agent; `503` DB. |
| `GET /agents/{agent_id}/medplum/cases` | Discover bounded cases in a synthetic agent's organization-resolved Practitioner panel. | `agent_id`, `organization_id`, `source_system`, `cases`, `count`; source FHIR refs are omitted. | `403` non-synthetic agent; `404/409` scope mapping; `502/503` Medplum. |
| `GET /forum/posts?status=published&specialty=...&author_physician_npi=...&limit=20&offset=0` | Public feed; only `published` or `closed` are allowed. | `posts`, `count`, `limit`, `offset`. | `403` for draft/private status; `422` pagination. |
| `GET /forum/posts/{post_id}` | Public thread. A synthetic owner may privately fetch their draft with `?viewer_physician_npi=...`. | Full forum post including `responses`. | `404` missing or private to viewer. |
| `GET /physicians/{npi}/review-inbox` | Synthetic physician's private draft lists. No request body. | `physician_npi`, `counts`, `post_drafts`, `response_drafts`. | `404` physician; `403` non-synthetic physician. |
| `GET /medplum/patients/{patient_id}/case-context` | Internal bounded synthetic case view. No body. | `patient_id`, `synthetic`, `age_band`, `conditions`, `medications`, `observations`, `source_resource_refs`. | `403` untagged/non-synthetic; `404` missing FHIR resource; `502/503` Medplum failures. |
| `POST /medplum/patients/{patient_id}/forum-posts/generate` | Generate Ethan's case-grounded post draft. Body: `{ "agent_id": "agent-9000000999", "physician_guidance": "..." }`. | Forum post fields plus private `medplum_link`; initial status is `awaiting_physician_approval`. | `409` lifecycle/permission; `403/404/502/503` Medplum; `502/503` generation; `422` body. |
| `POST /forum/posts/{post_id}/approve` | Owning physician publishes a post. Body: `{ "physician_npi": "9000000999" }`. | Updated forum post and approval provenance. | `403` wrong owner; `404` post; `409` invalid state. |
| `POST /forum/posts/{post_id}/monitor` | Run all eligible grounded physician agents. No body. | `post_id`, `agents_evaluated`, `results`. | `404` post; `409` ineligible/not Medplum-grounded; `502/503` Medplum/runtime. |
| `GET /forum/responses/{response_id}/grounding-review?physician_npi=9000001000` | Private grounding review for the response owner. | `response`; `grounding` with safe summaries, similarity/difference/unknown lists, and safe trace. | `403` wrong owner; `404` response or grounding. |
| `POST /forum/responses/{response_id}/approve` | Owning physician publishes a response. Body: `{ "physician_npi": "9000001000" }`. | Updated forum response and provenance. | `403` wrong owner; `404` response; `409` invalid state. |
| `POST /forum/posts/{post_id}/export-to-medplum` | Export only an approved post with at least one approved published response. No body. | `post_id`, `medplum_patient_id`, `communication_id`, `status`, `exported_at`. | `404` post; `409` no link/unapproved/no approved response; `502/503` Medplum. |
| `GET /integrations/medplum/health` | Check configuration/auth/FHIR reachability. No body. | `configured`, `authenticated`, `fhir_reachable`, `project_id_configured`; when unconfigured also `error`. | Unconfigured is HTTP `200` with false flags; auth is `502`; unreachable is `503`. |

Adjacent implemented routes include post/response rejection, manual draft creation, model-only response
generation, a single-agent monitoring trigger, and `GET /forum/posts/{post_id}/medplum-link`. Inspect
`/docs` before integrating those secondary paths.

### Exact request models used above

`GenerateMedplumPostInput`:

```json
{ "agent_id": "agent-9000000999", "physician_guidance": "Ask a bounded question." }
```

`PhysicianApprovalInput` for a post or response:

```json
{ "physician_npi": "9000000999" }
```

`AgentMonitoringRunInput`, used only by `POST /agents/{agent_id}/monitoring/run`:

```json
{ "post_id": "POST_ID" }
```

Extra fields are rejected.

## 8. Example frontend requests

The implemented API client discovers Ethan's environment-specific Patient ID from his authorized
panel. It does not hardcode a Patient or resource ID.

```js
const API_BASE = "http://127.0.0.1:8001";

async function api(path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
  return payload;
}

// 1. Discover Ethan's bounded authorized cases without source FHIR references.
const panel = await api("/agents/agent-9000000999/medplum/cases");
const ethanCase = panel.cases[0];
const ethanPatientId = ethanCase.patient_id;

// 2. Generate Ethan's post draft.
const postDraft = await api(
  `/medplum/patients/${encodeURIComponent(ethanPatientId)}/forum-posts/generate`,
  {
    method: "POST",
    body: JSON.stringify({
      agent_id: "agent-9000000999",
      physician_guidance:
        "Ask whether others have seen a similar synthetic medication presentation.",
    }),
  },
);

// 3. Ethan approves and publishes it.
const publishedPost = await api(`/forum/posts/${postDraft.id}/approve`, {
  method: "POST",
  body: JSON.stringify({ physician_npi: "9000000999" }),
});

// 4. Trigger grounded monitoring.
const monitoring = await api(`/forum/posts/${publishedPost.id}/monitor`, {
  method: "POST",
});
const lianneResult = monitoring.results.find(
  (result) => result.agent_id === "agent-9000001000",
);

// 5. Fetch Lianne's review inbox and private grounding evidence.
const lianneInbox = await api(`/physicians/9000001000/review-inbox`);
const responseId = lianneResult?.response_id;
if (!responseId) throw new Error("Monitoring did not create a response draft");
const groundingReview = await api(
  `/forum/responses/${responseId}/grounding-review?physician_npi=9000001000`,
);

// 6. Lianne approves her response.
const publishedResponse = await api(`/forum/responses/${responseId}/approve`, {
  method: "POST",
  body: JSON.stringify({ physician_npi: "9000001000" }),
});

// 7. Export the approved discussion to Ethan's synthetic chart.
const exportResult = await api(`/forum/posts/${publishedPost.id}/export-to-medplum`, {
  method: "POST",
});
```

An abstention or failed run has no response to review or approve; production UI should render the
monitoring outcome rather than throwing as this compact example does.

## 9. Important response fields

### Forum post

`id`, `title`, `clinical_question`, `context_summary`, `specialty_tags`,
`case_classification`, `status`, `author`, `provenance`, `responses`,
`published_response_count`, and timestamps.

`author` contains `physician_npi`, `physician_name`, `verified_specialty`, `organization`, and
`agent_id`. `provenance` contains `drafted_by_agent`, `draft_origin`, `physician_approved`,
`approved_at`, `prompt_version`, `model`, and `generated_at`.

### Forum response

`id`, `post_id`, `response_type`, `headline`, `content`, `citations`, `status`, `author`,
`provenance`, and timestamps. Public responses appear inside the post's `responses` array only after
approval/publication.

### Grounding

Public `provenance.grounding` contains exactly:

```json
{
  "grounding_mode": "medplum_case_match",
  "source_system": "medplum",
  "matched_case_count": 1
}
```

### Review inbox

`counts` has `posts` and `responses`; `post_drafts` and `response_drafts` contain full private draft
payloads owned by that synthetic physician.

### Monitoring result

Each item in `results` has `agent_id`, `physician_name`, `candidate`, `monitoring_run_id`, `outcome`,
`matched_case_count`, `response_id`, and `safe_error_category`. Current outcomes are `skipped`,
`no_relevant_case`, `draft_created`, and `failed`.

## 10. Public vs private grounding information

The public thread may show the Medplum grounding source, matched-case count, responding physician,
verified specialty, and physician-approval state.

It must not show source Patient IDs, Condition/Observation/MedicationRequest IDs, opaque case refs,
raw FHIR, or another physician's bounded supporting-case details.

Lianne's private grounding-review route may show safe bounded supporting-case summaries and opaque
case refs. The general case-context and Medplum-link endpoints are internal integration views and
do return provenance identifiers; do not reuse their JSON in a public component.

## 11. Frontend security rules

- Never bundle API secrets into browser code.
- Never call OpenAI or Medplum directly from the browser for this MVP.
- Never expose raw patient/resource identifiers unless a backend endpoint intentionally returns
  them for a private internal view.
- Treat backend status and approval provenance as authoritative.
- Do not simulate approval solely in frontend state.
- Do not publish by mutating UI state; call the owning physician's backend approval endpoint and
  render its response.
- Do not treat NPPES directory presence as Lamina participation or verification.

## Organization / Medplum integration

Lamina organizations own Medplum connections; physicians participate through organization
memberships. The backend derives the organization from the trusted physician agent, selects that
organization's Medplum project, and then applies the physician's Practitioner mapping to restrict
the patient panel. The browser and the Agents SDK never choose the organization or handle client
credentials.

For the hackathon, **Lamina Demo Medical Group** uses the server-side, environment-backed
`DEFAULT_MEDPLUM` connection. Production should replace this credential source with a secrets
manager or delegated OAuth/SMART-on-FHIR flow. Safe frontend/admin endpoints are:

| Method and path | Safe purpose |
|---|---|
| `GET /organizations` | Organization summaries and member/connection status. |
| `GET /organizations/{id}` | Organization detail with safe Medplum status metadata. |
| `GET /organizations/{id}/members` | Physician, agent, role, status, and verified specialty. |
| `GET /organizations/{id}/integrations/medplum` | Safe connection configuration/status; no credential values. |
| `POST /organizations/{id}/integrations/medplum/test` | Server-side authentication/reachability test and safe health result. |

Never add fields for a Medplum client ID, client secret, bearer token, or Authorization header to
frontend state or forms. The existing global health endpoint remains available for demo
compatibility and resolves internally through the demo organization.

## 12. CORS

FastAPI explicitly allows the Vite development origins `http://localhost:5173` and
`http://127.0.0.1:5173`, plus the deployed origin
`https://frontend-nu-weld-79.vercel.app`, without cross-origin credentials. Additional trusted
frontend origins can be appended with the server-side, comma-separated `LAMINA_CORS_ORIGINS`
environment variable. The built-in local and deployed origins remain available. No wildcard
origin is enabled. The backend tunnel URL is an API destination, not a browser origin, and does
not need to be added to this CORS list.

## 13. Demo data setup

For a fresh local directory, `build-demo.ps1` downloads/builds a 20,000-profile demo database. Do
not run it as a reset against a database whose local demo workflow state must be preserved.

```powershell
# Fresh directory database only
.\scripts\build-demo.ps1

# Idempotent, non-destructive synthetic Ethan/Lianne physician seed
.\scripts\seed-demo-physician.ps1

# Idempotent demo organization, memberships, and environment connection reference
.\scripts\seed-demo-organization.ps1

# Idempotent synthetic Medplum practitioner/patient panel seed; loads .env
.\scripts\seed-medplum-demo-patient.ps1

# Frontend dependencies and local server
Set-Location .\frontend
npm install
Copy-Item .env.example .env.local
npm run dev

# Readiness checks / guarded walkthroughs
.\scripts\test-medplum-connection.ps1
.\scripts\smoke-test-medplum-flow.ps1 -PatientId <PATIENT_ID>
.\scripts\demo-grounded-monitoring.ps1
.\scripts\demo-grounded-monitoring.ps1 -PostId <APPROVED_POST_ID>
```

The Medplum seed prints environment-specific IDs under stable role labels: `ethan_index`,
`lianne_strong`, `lianne_partial`, and `lianne_near_miss`. Parse or copy the `ethan_index Patient`
value at setup time. Do not commit or hardcode returned resource IDs. There is no standalone reset
script.

## 14. Error handling the frontend should support

| Case | UI behavior |
|---|---|
| Backend unavailable | Show connection error and retry; do not fake success. |
| OpenAI unconfigured | Generation returns `503`; show server configuration required. |
| Medplum unconfigured | Health returns `200` with `configured=false`; disable clinical actions. |
| Medplum auth failed | Health/action returns `502`; show integration authentication failure. |
| Post awaiting approval | Keep it out of the public feed; show it only in Ethan's review UI. |
| Wrong physician approval | `403`; retain current state and explain ownership restriction. |
| No relevant grounded case | `outcome="no_relevant_case"`; show abstention, not a generic answer. |
| Monitoring failed | `outcome="failed"` or route `503`; show safe error state and retry option. |
| Duplicate monitoring trigger | The backend is idempotent for an existing draft/published response and returns the existing `response_id`; do not duplicate cards. |
| Export without approved response | `409`; disable export until at least one response is physician-approved and published. |

## 15. Intentionally not implemented yet

- Deepgram voice capture/transcription. The existing voice-drafting permission is configuration,
  not a transcription implementation.
- Production authentication and a non-demo organization administration UI.
- Weekly/monthly network intelligence report generation. Preferences exist; generation does not.
- Background, scheduled, or event-driven monitoring. Monitoring is manually triggered by POST.
- Production authentication/authorization. Demo ownership checks use supplied NPIs; there is no
  user session or production identity provider.
- Real-patient/PHI support. Current clinical workflows require explicitly tagged synthetic data.

## 16. Frontend integration checklist

- [ ] Backend running
- [ ] Medplum health passes
- [ ] Ethan case loads
- [ ] Ethan draft generation works
- [ ] Ethan approval works
- [ ] Published post loads
- [ ] Monitoring triggers
- [ ] Lianne grounded response appears in review inbox
- [ ] Grounding badge/count renders
- [ ] Lianne approval works
- [ ] Published response loads
- [ ] Medplum export works
- [ ] No secrets are present in frontend code

## 17. Integration checks / possible blockers

- **Frontend mocks outside Clinical Demo:** the legacy feed, Publication Center, Agent Setup,
  Agent Connections, assistant, profile, and signup views still use teammate-provided local data.
- **Port documentation mismatch:** older general README sections use port `8000`; the current
  Medplum/monitoring scripts and this handoff use `8001`.
- **Model-only route:** `POST /forum/posts/{post_id}/responses/generate` still creates an ungrounded
  response draft. Its public grounding metadata is `grounding_mode="model_only"`,
  `source_system="openai"`, `matched_case_count=0`. Never render it as **Grounded in Medplum**.
- **Internal identifier routes:** case-context, Medplum-link, and export responses intentionally
  contain patient/resource provenance identifiers for internal integration UI. Do not place those
  payloads in public thread state.
- No route-name mismatch was found for the primary flow. JSON is explicitly served as UTF-8, and
  no machine-specific absolute path is required by the documented commands.
