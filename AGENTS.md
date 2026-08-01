# Lamina project instructions

Lamina is an agent-managed clinical forum. Physicians retain authorship and approve all clinical posts and responses. Agents may discover, draft, route, summarize, and prepare content, but must not publish clinical statements as a physician without explicit approval.

## Physician directory

- NPPES records are directory data, not proof of current licensure or participation.
- Imported physician profiles must default to `unclaimed`.
- Imported agent profiles must default to `reserved` and `inactive`.
- Never imply that an unclaimed physician joined, endorsed, or authorized Lamina.
- Use fictional physicians and synthetic patient cases in demonstrations.
- Never activate imported real physicians through demo verification.
- Preserve explicit synthetic versus NPPES provenance.

## Agent safety

- Never allow autonomous clinical publication; physician approval is always required.
- Agents draft; physicians publish.
- Only synthetic cases are supported until proper privacy controls exist.
- Never expose drafts in the public feed.
- Never let one physician approve another physician's content.
- Preserve authorship, draft origin, and physician approval provenance for every post and response.
- Future voice and LLM features must use the existing draft services and approval workflow.
- AI creates drafts only; physicians approve and publish.
- Never invent citations or claim generated text represents the physician before approval.
- Deepgram must call the existing post-generation service.
- Agents SDK report workflows must not bypass physician review.
- Never expose API keys, raw provider errors, or sensitive generation inputs in audit metadata.
- Preserve model, prompt-version, agent, owner, generation, and approval provenance.
- Use one shared agent runtime in future work, not a process or model instance per physician.
- Monitoring preferences are stored configuration and do not imply monitoring exists.

## Engineering

- Keep NPPES source files and generated databases out of Git.
- Preserve NPI as a string so leading digits and formatting are never altered.
- Do not place secrets in source code.
- Add indexes only after bulk ingestion where possible.
- Run tests and linting after material changes.

## Medplum integration

- Medplum is Lamina's FHIR clinical-data layer, and Lamina mediates all Medplum access.
- Medplum credentials belong to organizations, not physician agents.
- Agents resolve Medplum only through trusted organization membership.
- Organization connection scope and Practitioner panel scope are separate authorization boundaries.
- Never let an LLM choose organization IDs, connection IDs, or credential sources.
- Never store plaintext Medplum client secrets or bearer tokens in application tables.
- Never expose credentials through API responses, logs, audit metadata, prompts, or model tools.
- Future credential storage must use a proper secrets manager, encrypted store, or delegated flow.
- Reject cross-organization patient access, provenance links, monitoring, and writeback.
- OpenAI never receives Medplum credentials, access tokens, or complete FHIR resources.
- Support only explicitly tagged synthetic patients and use the minimum necessary context.
- Never send patient names, identifiers, addresses, contact details, or exact birth dates to a model.
- AI creates drafts only; physicians approve and publish through the existing workflow.
- Never export unapproved Lamina content to Medplum.
- Preserve provenance links between FHIR resources and Lamina content.
- Use stable FHIR identifiers for idempotent writes.
- Never destructively modify unrelated Medplum resources.
- Future Agents SDK and Deepgram integrations must reuse these approval and Medplum safety boundaries.

## Grounded physician-agent monitoring

- Medplum is the source of patient-grounded facts.
- Physician specialty and expertise are routing metadata, not sufficient clinical grounding.
- Monitoring-generated clinical responses require explicit grounding provenance.
- Agents must abstain when no authorized grounded evidence exists.
- Never fall back from failed retrieval to generic model advice.
- Enforce physician patient-panel boundaries in backend code, never prompt text.
- Agent tools expose bounded Lamina abstractions, never raw FHIR or arbitrary patient lookup.
- The Agents SDK may search, read, compare, and draft, but cannot approve or publish.
- Existing physician ownership and approval endpoints remain authoritative.
- Never expose another physician's source patient information publicly.
- Public grounding provenance may expose only source system and supporting-case count.
- Deepgram will later feed physician speech into the existing post-generation path.
- Monitoring must remain reusable from a future `post_published` event.
