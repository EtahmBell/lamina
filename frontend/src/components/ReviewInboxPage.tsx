import { useCallback, useEffect, useState } from 'react'
import {
  approveForumResponse,
  getGroundingReview,
  getReviewInbox,
  type AgentDetails,
  type ForumResponse,
  type GroundingReview,
} from '../api/client'
import { displayError } from '../utils'
import { PhysicianAvatar } from './PhysicianAvatar'
import { Badge, EmptyState, ErrorBanner, PageLoading, PrimaryButton } from './ui'

export function ReviewInboxPage({
  focusedPostId,
  physician,
  onApproved,
}: {
  focusedPostId: string | null
  physician: AgentDetails
  onApproved: (postId: string) => void
}) {
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
          await getGroundingReview(response.id, physician.physician_npi),
        )
      }
    } catch (loadError) {
      setError(displayError(loadError))
    }
  }, [physician.physician_npi])

  const loadInbox = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const inbox = await getReviewInbox(physician.physician_npi)
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
  }, [focusedPostId, openResponse, physician.physician_npi])

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
        physician.physician_npi,
      )
      onApproved(approved.post_id)
    } catch (approvalError) {
      setError(displayError(approvalError))
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return <div className="page-shell"><PageLoading>Loading physician review...</PageLoading></div>
  }

  return (
    <div className="page-shell">
      <header className="page-hero">
        <div>
          <div className="eyebrow">Physician approval</div>
          <h1 className="page-title mt-1">Publication Review</h1>
          <p className="secondary-copy mt-2">
            Review drafts prepared by Lamina before anything is published on your behalf.
          </p>
        </div>
        <button type="button" onClick={() => void loadInbox()} className="text-action ml-auto">
          Refresh
        </button>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <PhysicianAvatar
          npi={physician.physician_npi}
          name={physician.physician.display_name}
          size="small"
        />
        <div>
          <div className="physician-name text-lg font-bold">
            {physician.physician.display_name}
          </div>
          <span className="metadata">{physician.physician.primary_specialty}</span>
        </div>
        <Badge tone="warning">Synthetic demo handoff</Badge>
      </div>
      <p className="secondary-copy mt-2 max-w-3xl">
        Production authentication is deferred. This explicit handoff demonstrates that only the
        physician who owns the response can approve it.
      </p>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      {responses.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No pending specialist reviews."
            detail="A grounded response appears only after backend monitoring creates one."
          />
        </div>
      ) : (
        <div className="mt-7 grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="surface h-fit divide-y divide-[var(--border)]" aria-label="Pending responses">
            <div className="eyebrow px-4 py-3 text-[var(--clinical)]">Responses</div>
            {responses.map((response) => (
              <button
                key={response.id}
                type="button"
                onClick={() => void openResponse(response)}
                className={`w-full border-l-2 px-4 py-4 text-left transition-colors ${
                  selected?.id === response.id
                    ? 'border-l-[var(--accent)] bg-[#f3e9df]'
                    : 'border-l-transparent hover:bg-[#f8f2e9]'
                }`}
              >
                <div className="metadata">
                  {response.provenance.grounding.matched_case_count} matched case
                  {response.provenance.grounding.matched_case_count === 1 ? '' : 's'}
                </div>
                <div className="publication-title mt-1 line-clamp-3 text-base">
                  {response.headline}
                </div>
              </button>
            ))}
          </aside>

          {selected && (
            <article className="review-document">
              <div className="eyebrow">Response draft</div>
              <div className="mt-3 flex flex-wrap gap-2 border-b border-[var(--border)] pb-5">
                <Badge>Draft prepared</Badge>
                {selected.provenance.grounding.source_system === 'medplum' && (
                  <Badge tone="clinical">Grounded in Medplum</Badge>
                )}
                <Badge>
                  {selected.provenance.grounding.matched_case_count} similar case
                  {selected.provenance.grounding.matched_case_count === 1 ? '' : 's'}
                </Badge>
                <Badge tone="warning">Awaiting physician approval</Badge>
              </div>
              <h2 className="publication-title mt-6 text-[1.45rem]">{selected.headline}</h2>
              <p className="body-copy mt-3 whitespace-pre-wrap">{selected.content}</p>

              {grounding && (
                <section className="mt-7 border-l-2 border-l-[var(--clinical)] bg-[#f2f0eb] px-5 py-4">
                  <div className="eyebrow text-[var(--clinical)]">Grounding review</div>
                  <p className="secondary-copy mt-2 text-[var(--text-primary)]">
                    {grounding.grounding.relevance_reason}
                  </p>
                  <div className="mt-4 grid gap-5 md:grid-cols-3">
                    <GroundingList title="Similarities" items={grounding.grounding.similarities} />
                    <GroundingList title="Differences" items={grounding.grounding.differences} />
                    <GroundingList title="Unknowns" items={grounding.grounding.unknowns} />
                  </div>
                </section>
              )}

              <footer className="mt-7 flex flex-wrap items-center gap-4 border-t border-[var(--border)] pt-5">
                <span className="metadata">
                  Approval publishes this response under {physician.physician.display_name}'s authorship.
                </span>
                <div className="ml-auto">
                  <PrimaryButton tone="approve" disabled={approving} onClick={() => void approve()}>
                    {approving ? 'Publishing response...' : 'Approve response'}
                  </PrimaryButton>
                </div>
              </footer>
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
    <div>
      <h3 className="metadata font-bold tracking-[0.08em] uppercase">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
        {items.map((item) => <li key={item} className="border-t border-[var(--border)] pt-2">{item}</li>)}
      </ul>
    </div>
  )
}
