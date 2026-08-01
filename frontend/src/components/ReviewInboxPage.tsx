import { useCallback, useEffect, useState } from 'react'
import {
  approveForumResponse,
  getAgent,
  getGroundingReview,
  getReviewInbox,
  type AgentDetails,
  type ForumResponse,
  type GroundingReview,
} from '../api/client'
import { demoSession } from '../session'
import { displayError } from '../utils'
import { Badge, EmptyState, ErrorBanner, PageLoading, PrimaryButton } from './ui'

export function ReviewInboxPage({
  focusedPostId,
  onApproved,
}: {
  focusedPostId: string | null
  onApproved: (postId: string) => void
}) {
  const [reviewer, setReviewer] = useState<AgentDetails | null>(null)
  const [responses, setResponses] = useState<ForumResponse[]>([])
  const [selected, setSelected] = useState<ForumResponse | null>(null)
  const [grounding, setGrounding] = useState<GroundingReview | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openResponse = useCallback(async (response: ForumResponse) => {
    setSelected(response)
    setGrounding(null)
    setError(null)
    try {
      if (response.provenance.grounding.source_system === 'medplum') {
        setGrounding(
          await getGroundingReview(response.id, demoSession.specialistReviewer.npi),
        )
      }
    } catch (loadError) {
      setError(displayError(loadError))
    }
  }, [])

  const loadInbox = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [agent, inbox] = await Promise.all([
        getAgent(demoSession.specialistReviewer.agentId),
        getReviewInbox(demoSession.specialistReviewer.npi),
      ])
      setReviewer(agent)
      setResponses(inbox.response_drafts)
      const preferred =
        inbox.response_drafts.find((response) => response.post_id === focusedPostId) ??
        inbox.response_drafts[0] ??
        null
      if (preferred) await openResponse(preferred)
      else {
        setSelected(null)
        setGrounding(null)
      }
    } catch (loadError) {
      setError(displayError(loadError))
    } finally {
      setLoading(false)
    }
  }, [focusedPostId, openResponse])

  useEffect(() => {
    void loadInbox()
  }, [loadInbox])

  const approve = async () => {
    if (!selected || approving) return
    setApproving(true)
    setError(null)
    try {
      const approved = await approveForumResponse(
        selected.id,
        demoSession.specialistReviewer.npi,
      )
      onApproved(approved.post_id)
    } catch (approvalError) {
      setError(displayError(approvalError))
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <PageLoading>Loading specialist review inbox...</PageLoading>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs font-bold tracking-wide text-indigo-600 uppercase">
            Synthetic specialist handoff
          </div>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Review Inbox</h1>
          <p className="mt-1 text-sm text-slate-500">
            Reviewing as {reviewer?.physician.display_name ?? 'the configured specialist'} ·{' '}
            {reviewer?.physician.primary_specialty}
          </p>
        </div>
        <Badge tone="amber">Demo identity switch</Badge>
        <button
          type="button"
          onClick={() => void loadInbox()}
          className="ml-auto text-sm font-semibold text-indigo-700 hover:text-indigo-900"
        >
          Refresh
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-500">
        Production authentication is deferred. This explicit synthetic handoff demonstrates that
        only the physician who owns the response can approve it.
      </p>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      {responses.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No pending specialist reviews."
            detail="A grounded response will appear only after backend monitoring creates one."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="space-y-2">
            {responses.map((response) => (
              <button
                key={response.id}
                type="button"
                onClick={() => void openResponse(response)}
                className={`w-full rounded-2xl border p-4 text-left ${
                  selected?.id === response.id
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                }`}
              >
                <div className="text-xs font-semibold text-slate-500">
                  {response.provenance.grounding.matched_case_count} matched case
                  {response.provenance.grounding.matched_case_count === 1 ? '' : 's'}
                </div>
                <div className="mt-1 line-clamp-2 font-semibold text-slate-900">
                  {response.headline}
                </div>
              </button>
            ))}
          </aside>

          {selected && (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone="indigo">AI drafted</Badge>
                {selected.provenance.grounding.source_system === 'medplum' && (
                  <Badge tone="emerald">Grounded in Medplum</Badge>
                )}
                <Badge>
                  {selected.provenance.grounding.matched_case_count} similar case
                  {selected.provenance.grounding.matched_case_count === 1 ? '' : 's'} found
                </Badge>
                <Badge tone="amber">Awaiting physician approval</Badge>
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">{selected.headline}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {selected.content}
              </p>

              {grounding && (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                  <h3 className="font-bold text-slate-900">Grounding review</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {grounding.grounding.relevance_reason}
                  </p>
                  <GroundingList title="Similarities" items={grounding.grounding.similarities} />
                  <GroundingList title="Differences" items={grounding.grounding.differences} />
                  <GroundingList title="Unknowns" items={grounding.grounding.unknowns} />
                </div>
              )}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <PrimaryButton tone="emerald" disabled={approving} onClick={() => void approve()}>
                  {approving ? 'Publishing specialist response...' : 'Approve as specialist'}
                </PrimaryButton>
              </div>
            </article>
          )}
        </div>
      )}
    </div>
  )
}

function GroundingList({ title, items }: { title: string; items: string[] }) {
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
