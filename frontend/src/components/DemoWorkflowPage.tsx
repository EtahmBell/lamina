import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  API_BASE_URL,
  ApiError,
  DEMO,
  approveForumPost,
  approveForumResponse,
  exportForumPost,
  generateForumPost,
  getAgentCases,
  getExportStatus,
  getForumFeed,
  getForumPost,
  getGroundingReview,
  getMedplumIntegration,
  getOrganizationMembers,
  getOrganizations,
  getReviewInbox,
  monitorForumPost,
  testMedplumIntegration,
  type CaseContext,
  type ForumPost,
  type ForumResponse,
  type GroundingReview,
  type MedplumIntegration,
  type MonitoringResult,
  type OrganizationMember,
  type OrganizationSummary,
} from '../api/client'

const POST_STORAGE_KEY = 'lamina.demo.postId'

type PendingAction =
  | 'loading'
  | 'connection'
  | 'generating'
  | 'post-approval'
  | 'monitoring'
  | 'response-approval'
  | 'exporting'
  | null

const initialGuidance =
  'Ask the physician network about the medication timing, dose relationship, and additional history that should be clarified. Do not make a diagnosis.'

function displayError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'The operation could not be completed. Please retry.'
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-700',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>
      {children}
    </span>
  )
}

function ActionButton({
  children,
  disabled,
  onClick,
  tone = 'indigo',
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
  tone?: 'indigo' | 'emerald'
}) {
  const active = tone === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition-colors ${active} disabled:cursor-not-allowed disabled:bg-slate-300`}
    >
      {children}
    </button>
  )
}

function PersonHeader({ response }: { response: ForumResponse }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div>
        <div className="font-bold text-slate-900">{response.author.physician_name}</div>
        <div className="text-sm text-slate-500">{response.author.verified_specialty}</div>
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        {response.provenance.draft_origin === 'agent_generated' && <Badge tone="indigo">AI drafted</Badge>}
        {response.provenance.physician_approved ? (
          <Badge tone="emerald">Physician approved</Badge>
        ) : (
          <Badge tone="amber">Awaiting physician approval</Badge>
        )}
        {response.provenance.grounding.source_system === 'medplum' && (
          <Badge tone="emerald">Grounded in Medplum</Badge>
        )}
      </div>
    </div>
  )
}

export function DemoWorkflowPage() {
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null)
  const [members, setMembers] = useState<OrganizationMember[]>([])
  const [integration, setIntegration] = useState<MedplumIntegration | null>(null)
  const [caseContext, setCaseContext] = useState<CaseContext | null>(null)
  const [post, setPost] = useState<ForumPost | null>(null)
  const [responseDraft, setResponseDraft] = useState<ForumResponse | null>(null)
  const [grounding, setGrounding] = useState<GroundingReview | null>(null)
  const [monitoringResults, setMonitoringResults] = useState<MonitoringResult[]>([])
  const [linkedToMedplum, setLinkedToMedplum] = useState(false)
  const [exported, setExported] = useState(false)
  const [guidance, setGuidance] = useState(initialGuidance)
  const [pending, setPending] = useState<PendingAction>('loading')
  const [error, setError] = useState<string | null>(null)
  const [caseError, setCaseError] = useState<string | null>(null)

  const lianneMember = members.find((member) => member.agent_id === DEMO.lianne.agentId)

  const loadGrounding = useCallback(async (response: ForumResponse | null) => {
    if (!response || response.provenance.grounding.source_system !== 'medplum') {
      setGrounding(null)
      return
    }
    try {
      setGrounding(await getGroundingReview(response.id))
    } catch {
      setGrounding(null)
    }
  }, [])

  const refreshWorkflow = useCallback(
    async (preferredPostId?: string) => {
      const [ethanInbox, lianneInbox, feed] = await Promise.all([
        getReviewInbox(DEMO.ethan.npi),
        getReviewInbox(DEMO.lianne.npi),
        getForumFeed(),
      ])
      const storedId = preferredPostId || window.localStorage.getItem(POST_STORAGE_KEY)
      let selectedPost: ForumPost | null = null
      let selectedExportState = { linked: false, exported: false }
      if (storedId) {
        try {
          const storedPost = await getForumPost(storedId)
          const storedExportState = await getExportStatus(storedId)
          if (storedExportState.linked) {
            selectedPost = storedPost
            selectedExportState = storedExportState
          } else {
            window.localStorage.removeItem(POST_STORAGE_KEY)
          }
        } catch (loadError) {
          if (!(loadError instanceof ApiError) || loadError.status !== 404) throw loadError
          window.localStorage.removeItem(POST_STORAGE_KEY)
        }
      }
      if (!selectedPost) {
        const candidates = [...ethanInbox.post_drafts].reverse().concat(feed)
        for (const candidate of candidates) {
          const candidateExportState = await getExportStatus(candidate.id)
          if (candidateExportState.linked) {
            selectedPost = candidate
            selectedExportState = candidateExportState
            break
          }
        }
      }
      setPost(selectedPost)
      if (!selectedPost) {
        setResponseDraft(null)
        setGrounding(null)
        setLinkedToMedplum(false)
        setExported(false)
        return
      }
      window.localStorage.setItem(POST_STORAGE_KEY, selectedPost.id)
      const draft =
        lianneInbox.response_drafts.find((item) => item.post_id === selectedPost?.id) ?? null
      setResponseDraft(draft)
      await loadGrounding(draft ?? selectedPost.responses[0] ?? null)
      setLinkedToMedplum(selectedExportState.linked)
      setExported(selectedExportState.exported)
    },
    [loadGrounding],
  )

  const loadPage = useCallback(async () => {
    setPending('loading')
    setError(null)
    try {
      const [organizations, organizationMembers, medplum] = await Promise.all([
        getOrganizations(),
        getOrganizationMembers(DEMO.organizationId),
        getMedplumIntegration(DEMO.organizationId),
      ])
      setOrganization(
        organizations.find((item) => item.id === DEMO.organizationId) ?? organizations[0] ?? null,
      )
      setMembers(organizationMembers)
      setIntegration(medplum)
      await refreshWorkflow()
    } catch (loadError) {
      setError(displayError(loadError))
    }
    try {
      const cases = await getAgentCases(DEMO.ethan.agentId)
      setCaseContext(cases[0] ?? null)
      setCaseError(cases.length ? null : 'No synthetic case was found in Ethan’s authorized panel.')
    } catch (loadError) {
      setCaseError(displayError(loadError))
    } finally {
      setPending(null)
    }
  }, [refreshWorkflow])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  const runAction = async (action: Exclude<PendingAction, 'loading' | null>, operation: () => Promise<void>) => {
    if (pending) return
    setPending(action)
    setError(null)
    try {
      await operation()
    } catch (actionError) {
      setError(displayError(actionError))
    } finally {
      setPending(null)
    }
  }

  const generate = () =>
    runAction('generating', async () => {
      if (!caseContext) throw new Error('No authorized synthetic case is available.')
      const generated = await generateForumPost(caseContext.patient_id, guidance)
      window.localStorage.setItem(POST_STORAGE_KEY, generated.id)
      setPost(generated)
      setResponseDraft(null)
      setGrounding(null)
      setMonitoringResults([])
      setLinkedToMedplum(true)
      setExported(false)
    })

  const approvePost = () =>
    runAction('post-approval', async () => {
      if (!post) return
      const approved = await approveForumPost(post.id)
      setPost(approved)
    })

  const monitor = () =>
    runAction('monitoring', async () => {
      if (!post) return
      const result = await monitorForumPost(post.id)
      setMonitoringResults(result.results)
      await refreshWorkflow(post.id)
    })

  const approveResponse = () =>
    runAction('response-approval', async () => {
      if (!responseDraft || !post) return
      await approveForumResponse(responseDraft.id)
      setResponseDraft(null)
      setPost(await getForumPost(post.id))
    })

  const exportPost = () =>
    runAction('exporting', async () => {
      if (!post) return
      await exportForumPost(post.id)
      setExported(true)
    })

  const startAnotherDemo = () => {
    window.localStorage.removeItem(POST_STORAGE_KEY)
    setPost(null)
    setResponseDraft(null)
    setGrounding(null)
    setMonitoringResults([])
    setLinkedToMedplum(false)
    setExported(false)
    setError(null)
  }

  const testConnection = () =>
    runAction('connection', async () => {
      const result = await testMedplumIntegration(DEMO.organizationId)
      setIntegration((current) =>
        current
          ? { ...current, status: result.status, configured: result.configured, last_error_category: null }
          : current,
      )
    })

  const lianneResult = useMemo(
    () => monitoringResults.find((result) => result.agent_id === DEMO.lianne.agentId),
    [monitoringResults],
  )
  const publicResponse = post?.responses.find(
    (response) => response.author.agent_id === DEMO.lianne.agentId,
  )

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold tracking-widest text-indigo-600 uppercase">Live backend workflow</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Grounded physician network demo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every status below is loaded from Lamina at {API_BASE_URL}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPage()}
          disabled={Boolean(pending)}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Refresh backend state
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Action unavailable.</strong> {error}
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">L</div>
          <div>
            <h2 className="font-bold text-slate-900">{organization?.name ?? 'Lamina Demo Medical Group'}</h2>
            <p className="text-sm text-slate-500">{members.length} active demo members</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${integration?.status === 'connected' ? 'bg-emerald-500' : integration?.configured ? 'bg-amber-500' : 'bg-rose-500'}`} />
            <span className="text-sm font-semibold text-slate-700">
              Medplum {integration?.status === 'connected' ? 'Connected ✓' : integration?.configured ? 'Configured' : 'Not configured'}
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {members.map((member) => (
            <Badge key={member.agent_id} tone={member.agent_id === DEMO.ethan.agentId ? 'indigo' : 'slate'}>
              {member.physician_name} · {member.verified_specialty}
            </Badge>
          ))}
          {integration?.last_verified_at && (
            <span className="text-xs text-slate-400">Verified {new Date(integration.last_verified_at).toLocaleString()}</span>
          )}
          <button
            type="button"
            disabled={Boolean(pending) || !integration?.configured}
            onClick={testConnection}
            className="ml-auto text-sm font-semibold text-indigo-700 hover:text-indigo-900 disabled:text-slate-400"
          >
            {pending === 'connection' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">1. Ethan’s Medplum case</h2>
          <Badge tone="emerald">Synthetic demo data</Badge>
          <Badge tone="indigo">Source: Medplum</Badge>
        </div>
        {caseError ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{caseError}</div>
        ) : caseContext ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <ClinicalList title={`Age ${caseContext.age_band}`} items={caseContext.conditions.map((item) => `${item.display} · ${item.clinical_status}`)} />
            <ClinicalList title="Medication context" items={caseContext.medications.map((item) => `${item.display} · ${item.timing_summary}`)} />
            <ClinicalList title="Observations / outcomes" items={caseContext.observations.map((item) => `${item.display}: ${item.value_summary}`)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Loading Ethan’s authorized synthetic panel…</p>
        )}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <label htmlFor="guidance" className="text-sm font-semibold text-slate-700">Physician guidance</label>
          <textarea
            id="guidance"
            rows={3}
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            disabled={Boolean(post)}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
          />
          <div className="mt-3 flex items-center gap-3">
            <ActionButton disabled={Boolean(pending) || !caseContext || Boolean(post) || !guidance.trim()} onClick={generate}>
              {pending === 'generating' ? 'Generating…' : 'Generate Ethan’s network question'}
            </ActionButton>
            {post && (
              <>
                <span className="text-xs text-slate-500">A backend-backed demo post is selected.</span>
                <button
                  type="button"
                  onClick={startAnotherDemo}
                  disabled={Boolean(pending)}
                  className="ml-auto text-sm font-semibold text-indigo-700 hover:text-indigo-900 disabled:text-slate-400"
                >
                  Start another demo question
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">2. Ethan review and publication</h2>
        {!post ? (
          <p className="mt-3 text-sm text-slate-500">Generate a case-grounded question to begin physician review.</p>
        ) : (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <div className="font-bold text-slate-900">{post.author.physician_name}</div>
                <div className="text-sm text-slate-500">{post.author.verified_specialty}</div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                {post.provenance.draft_origin === 'agent_generated' && <Badge tone="indigo">AI drafted</Badge>}
                {post.provenance.physician_approved ? <Badge tone="emerald">Physician approved</Badge> : <Badge tone="amber">Awaiting physician approval</Badge>}
                {linkedToMedplum && <Badge tone="emerald">Grounded in Medplum</Badge>}
              </div>
            </div>
            <h3 className="mt-4 text-xl font-bold text-slate-900">{post.title}</h3>
            <p className="mt-2 font-medium text-slate-800">{post.clinical_question}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{post.context_summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {post.specialty_tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
            </div>
            {post.status === 'awaiting_physician_approval' && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <ActionButton disabled={Boolean(pending)} onClick={approvePost} tone="emerald">
                  {pending === 'post-approval' ? 'Approving…' : 'Approve as Ethan'}
                </ActionButton>
              </div>
            )}
            {post.status === 'published' && (
              <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Published to the physician network ✓</div>
            )}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">3. Grounded monitoring</h2>
            <p className="text-sm text-slate-500">Route the published question and search authorized physician experience.</p>
          </div>
          <div className="ml-auto">
            <ActionButton disabled={Boolean(pending) || post?.status !== 'published'} onClick={monitor}>
              {pending === 'monitoring' ? 'Running grounded monitoring…' : 'Trigger monitoring'}
            </ActionButton>
          </div>
        </div>
        {pending === 'monitoring' && (
          <div className="mt-4 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-800">
            Finding relevant physician agents. The backend will apply organization and authorized-panel boundaries before returning results.
          </div>
        )}
        {lianneResult && (
          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-indigo-950">{lianneResult.physician_name}</strong>
              {lianneResult.candidate && <Badge tone="indigo">Candidate selected</Badge>}
              <Badge tone={lianneResult.outcome === 'draft_created' ? 'emerald' : lianneResult.outcome === 'failed' ? 'rose' : 'slate'}>
                {lianneResult.outcome.replaceAll('_', ' ')}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-indigo-900">
              {lianneResult.matched_case_count > 0
                ? `${lianneResult.matched_case_count} authorized similar ${lianneResult.matched_case_count === 1 ? 'case' : 'cases'} matched.`
                : lianneResult.outcome === 'no_relevant_case'
                  ? 'No relevant grounded case was found; no response was drafted.'
                  : 'No supporting case match was returned.'}
            </p>
            {lianneResult.safe_error_category && <p className="mt-1 text-xs text-rose-700">Safe error: {lianneResult.safe_error_category}</p>}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">4. Lianne review</h2>
        {responseDraft ? (
          <div className="mt-4">
            <PersonHeader response={responseDraft} />
            <h3 className="mt-4 font-bold text-slate-900">{responseDraft.headline}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{responseDraft.content}</p>
            {grounding && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="emerald">Grounded in Medplum</Badge>
                  <Badge>{grounding.grounding.matched_case_count} similar case{grounding.grounding.matched_case_count === 1 ? '' : 's'}</Badge>
                </div>
                <p className="mt-3 text-sm text-slate-700">{grounding.grounding.relevance_reason}</p>
                <EvidenceList title="Similarities" items={grounding.grounding.similarities} />
                <EvidenceList title="Differences" items={grounding.grounding.differences} />
                <EvidenceList title="Unknowns" items={grounding.grounding.unknowns} />
              </div>
            )}
            <div className="mt-4 border-t border-slate-100 pt-4">
              <ActionButton disabled={Boolean(pending)} onClick={approveResponse} tone="emerald">
                {pending === 'response-approval' ? 'Approving…' : 'Approve as Lianne'}
              </ActionButton>
            </div>
          </div>
        ) : publicResponse ? (
          <div className="mt-4">
            <PersonHeader response={publicResponse} />
            <h3 className="mt-4 font-bold text-slate-900">{publicResponse.headline}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{publicResponse.content}</p>
            <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              Lianne’s approved response is visible on the public thread ✓
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            {lianneMember ? 'Lianne’s grounded response draft will appear here after monitoring.' : 'Lianne is not present in the organization membership response.'}
          </p>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">5. Medplum writeback</h2>
            <p className="text-sm text-slate-500">Only the physician-approved discussion is eligible for export.</p>
          </div>
          <div className="ml-auto">
            <ActionButton disabled={Boolean(pending) || !publicResponse || !linkedToMedplum || exported} onClick={exportPost} tone="emerald">
              {pending === 'exporting' ? 'Saving…' : exported ? 'Exported to Medplum ✓' : 'Export approved discussion'}
            </ActionButton>
          </div>
        </div>
        {exported && (
          <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            Exported to Medplum ✓ Repeating the backend export remains idempotent.
          </div>
        )}
      </section>
    </div>
  )
}

function ClinicalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm text-slate-600">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  )
}

function EvidenceList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-3">
      <h4 className="text-xs font-bold tracking-wide text-slate-500 uppercase">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm text-slate-600">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  )
}
