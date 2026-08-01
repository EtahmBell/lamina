import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getForumFeed,
  getForumPost,
  getPhysicianProfile,
  searchPhysicians,
  type AgentDetails,
  type ForumPost,
  type PhysicianDirectoryResult,
} from '../api/client'
import { ASK_LAMINA_UNSUPPORTED, isReferralRequest, networkSearchTerms } from '../askLamina'
import { displayError, formatTimestamp } from '../utils'
import { AskLaminaComposer } from './AskLaminaComposer'
import { ForumPostView } from './ForumPostView'
import { PhysicianAvatar } from './PhysicianAvatar'
import { Badge, EmptyState, ErrorBanner, PageLoading } from './ui'

export function NetworkPage({
  focusedPostId,
  physician,
}: {
  focusedPostId: string | null
  physician: AgentDetails
}) {
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null)
  const [feedSearch, setFeedSearch] = useState('')
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [directoryState, setDirectoryState] = useState('')
  const [directoryResults, setDirectoryResults] = useState<PhysicianDirectoryResult[]>([])
  const [selectedPhysician, setSelectedPhysician] = useState<PhysicianDirectoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const feed = await getForumFeed()
      setPosts(feed)
      if (focusedPostId) {
        setSelectedPost(await getForumPost(focusedPostId, physician.physician_npi))
      }
    } catch (loadError) {
      setError(displayError(loadError))
    } finally {
      setLoading(false)
    }
  }, [focusedPostId, physician.physician_npi])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  const visiblePosts = useMemo(() => {
    const query = feedSearch.trim().toLowerCase()
    if (!query) return posts
    return posts.filter((post) =>
      [
        post.title,
        post.clinical_question,
        post.context_summary,
        post.author.physician_name,
        post.author.verified_specialty,
        ...post.specialty_tags,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [feedSearch, posts])

  const runDirectorySearch = async (event: FormEvent) => {
    event.preventDefault()
    if (directoryQuery.trim().length < 2) return
    setSearching(true)
    setError(null)
    setSelectedPhysician(null)
    try {
      setDirectoryResults(
        await searchPhysicians(directoryQuery.trim(), directoryState.trim() || undefined),
      )
    } catch (searchError) {
      setDirectoryResults([])
      setError(displayError(searchError))
    } finally {
      setSearching(false)
    }
  }

  const openPhysician = async (npi: string) => {
    setSearching(true)
    setError(null)
    try {
      setSelectedPhysician(await getPhysicianProfile(npi))
    } catch (profileError) {
      setError(displayError(profileError))
    } finally {
      setSearching(false)
    }
  }

  const askLamina = async (request: string): Promise<string> => {
    if (isReferralRequest(request) || /\b(ask|draft|question)\b/i.test(request)) {
      return ASK_LAMINA_UNSUPPORTED
    }
    const results = await getForumFeed(networkSearchTerms(request))
    setSelectedPost(null)
    setFeedSearch('')
    setPosts(results)
    return results.length
      ? `Found ${results.length} published discussion${results.length === 1 ? '' : 's'}.`
      : 'No published discussions matched this request.'
  }

  if (loading && posts.length === 0) {
    return <div className="page-shell"><PageLoading>Loading published physician discussions...</PageLoading></div>
  }

  return (
    <div className="page-shell">
      <header className="page-hero">
        <div>
          <div className="eyebrow">Clinical discussion</div>
          <h1 className="page-title mt-1">Physician Network</h1>
          <p className="secondary-copy mt-2">
            Learn from physician-approved clinical discussions across your network.
          </p>
        </div>
        <button type="button" onClick={() => void loadFeed()} className="text-action ml-auto">
          Refresh
        </button>
      </header>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <div className="mt-6">
        <AskLaminaComposer
          contextLabel={selectedPost
            ? `${physician.physician.display_name} · selected discussion`
            : `${physician.physician.display_name} · published network`}
          placeholder="Find published discussions about a clinical topic..."
          processingLabel="Searching your physician network..."
          suggestions={[
            'Find medication-tolerance discussions',
            'Show recent endocrinology questions',
          ]}
          onSubmit={askLamina}
        />
      </div>

      {selectedPost ? (
        <section className="mt-6">
          <button type="button" onClick={() => setSelectedPost(null)} className="text-action mb-4">
            Back to network
          </button>
          <ForumPostView post={selectedPost} />
        </section>
      ) : (
        <>
          <section className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="section-title">Published discussions</h2>
              <Badge tone="success">Physician approved</Badge>
              <span className="metadata ml-auto">{visiblePosts.length} discussions</span>
            </div>
            <input
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Filter published discussions"
              aria-label="Filter published discussions"
              className="input-control mt-4"
            />
            <div className="mt-4 space-y-4">
              {visiblePosts.map((post) => (
                <article key={post.id} className="feed-card">
                  <div className="flex items-center gap-3">
                    <PhysicianAvatar
                      npi={post.author.physician_npi}
                      name={post.author.physician_name}
                      size="medium"
                    />
                    <div className="min-w-0">
                      <div className="physician-name truncate text-lg font-bold">
                        {post.author.physician_name}
                      </div>
                      <div className="metadata mt-0.5">
                        {post.author.verified_specialty} · {formatTimestamp(post.published_at)}
                      </div>
                    </div>
                    <span className="ml-auto"><Badge tone="success">Approved</Badge></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPost(post)}
                    className="mt-5 block w-full text-left"
                  >
                    <h3 className="publication-title text-[1.35rem]">{post.title}</h3>
                    <p className="body-copy mt-2 line-clamp-3 text-[0.98rem] text-[var(--text-secondary)]">
                      {post.clinical_question}
                    </p>
                  </button>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                    {post.specialty_tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                    <span className="feed-response-count ml-auto">
                      {post.published_response_count} physician response
                      {post.published_response_count === 1 ? '' : 's'}
                    </span>
                  </div>
                </article>
              ))}
              {visiblePosts.length === 0 && (
                <div className="surface p-5">
                  <EmptyState
                    title="No discussions have been published yet."
                    detail="Use the optional showcase seed for a populated demo, or publish through the physician approval workflow."
                  />
                </div>
              )}
            </div>
          </section>

          <section className="section-rule mt-10 pt-8">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="section-title">Physician Directory</h2>
              <Badge tone="clinical">NPPES-backed search</Badge>
            </div>
            <p className="secondary-copy mt-1">
              Directory records do not imply that a physician joined or authorized Lamina.
            </p>
            <form onSubmit={runDirectorySearch} className="mt-4 flex flex-wrap gap-2">
              <input
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                placeholder="Search physician name or specialty"
                className="input-control min-w-64 flex-1"
              />
              <input
                value={directoryState}
                onChange={(event) => setDirectoryState(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="State"
                aria-label="State abbreviation"
                className="input-control w-24 uppercase"
              />
              <button
                type="submit"
                disabled={searching || directoryQuery.trim().length < 2 ||
                  (directoryState.length > 0 && directoryState.length !== 2)}
                className="button-primary"
              >
                {searching ? 'Searching...' : 'Search NPPES'}
              </button>
            </form>

            {selectedPhysician && (
              <article className="surface mt-5 border-l-4 border-l-[var(--clinical)] px-5 py-5">
                <div className="flex items-start gap-4">
                  <PhysicianAvatar
                    npi={selectedPhysician.npi}
                    name={selectedPhysician.display_name}
                    size="large"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={selectedPhysician.source.toLowerCase() === 'synthetic' ? 'success' : 'clinical'}>
                        {selectedPhysician.source.toLowerCase() === 'synthetic'
                          ? 'Active synthetic physician'
                          : 'NPPES directory profile'}
                      </Badge>
                      <Badge tone={selectedPhysician.agent_status === 'active' ? 'success' : 'warning'}>
                        {selectedPhysician.agent_status === 'active'
                          ? 'Active Lamina agent'
                          : `${selectedPhysician.agent_status} agent · inactive`}
                      </Badge>
                    </div>
                    <h3 className="physician-name mt-4 text-2xl font-bold">{selectedPhysician.display_name}</h3>
                    <p className="secondary-copy mt-1">
                      {selectedPhysician.primary_specialty || 'Specialty not listed'}
                      {selectedPhysician.city ? ` · ${selectedPhysician.city}, ${selectedPhysician.state}` : ''}
                    </p>
                    <p className="metadata mt-3">NPI {selectedPhysician.npi}</p>
                    {selectedPhysician.source.toLowerCase() !== 'synthetic' && (
                      <p className="secondary-copy mt-4 border-t border-[var(--border)] pt-4">
                        This physician has not claimed or authorized this Lamina directory profile.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            )}

            <div className="surface mt-5 divide-y divide-[var(--border)]">
              {directoryResults.map((directoryPhysician) => (
                <button
                  key={directoryPhysician.npi}
                  type="button"
                  onClick={() => void openPhysician(directoryPhysician.npi)}
                  className="flex w-full flex-wrap items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-[#f8f2e9]"
                >
                  <PhysicianAvatar
                    npi={directoryPhysician.npi}
                    name={directoryPhysician.display_name}
                    size="small"
                  />
                  <div>
                    <div className="physician-name text-lg font-bold">{directoryPhysician.display_name}</div>
                    <div className="secondary-copy mt-0.5">
                      {directoryPhysician.primary_specialty || 'Specialty not listed'}
                      {directoryPhysician.city ? ` · ${directoryPhysician.city}, ${directoryPhysician.state}` : ''}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Badge tone={directoryPhysician.source.toLowerCase() === 'synthetic' ? 'success' : 'clinical'}>
                      {directoryPhysician.source.toLowerCase() === 'synthetic' ? 'Synthetic' : 'NPPES'}
                    </Badge>
                    <Badge tone={directoryPhysician.agent_status === 'active' ? 'success' : 'warning'}>
                      {directoryPhysician.agent_status === 'active' ? 'Active' : 'Unclaimed · reserved'}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
            {directoryQuery.trim().length >= 2 && !searching && directoryResults.length === 0 && (
              <p className="secondary-copy mt-4">No physicians matched the submitted search.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
