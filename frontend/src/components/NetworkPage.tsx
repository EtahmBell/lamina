import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getForumFeed,
  getForumPost,
  getPhysicianProfile,
  searchPhysicians,
  type ForumPost,
  type PhysicianDirectoryResult,
} from '../api/client'
import { displayError } from '../utils'
import { ForumPostView } from './ForumPostView'
import { Badge, EmptyState, ErrorBanner, PageLoading } from './ui'

export function NetworkPage({
  focusedPostId,
  viewerPhysicianNpi,
}: {
  focusedPostId: string | null
  viewerPhysicianNpi: string
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
        setSelectedPost(await getForumPost(focusedPostId, viewerPhysicianNpi))
      }
    } catch (loadError) {
      setError(displayError(loadError))
    } finally {
      setLoading(false)
    }
  }, [focusedPostId, viewerPhysicianNpi])

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

  const runDirectorySearch = async (event: React.FormEvent) => {
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

  if (loading && posts.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <PageLoading>Loading published physician discussions...</PageLoading>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-24">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Physician Network</h1>
          <p className="mt-1 text-sm text-slate-500">
            Published, physician-approved discussions and the live NPPES directory.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadFeed()}
          className="ml-auto text-sm font-semibold text-indigo-700 hover:text-indigo-900"
        >
          Refresh
        </button>
      </div>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      {selectedPost ? (
        <section className="mt-6">
          <button
            type="button"
            onClick={() => setSelectedPost(null)}
            className="mb-4 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Back to network
          </button>
          <ForumPostView post={selectedPost} />
        </section>
      ) : (
        <>
          <section className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">Published discussions</h2>
              <Badge tone="emerald">Backend feed</Badge>
            </div>
            <input
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Filter published discussions"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-4 space-y-4">
              {visiblePosts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => setSelectedPost(post)}
                  className="block w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{post.author.physician_name}</span>
                    <span className="text-sm text-slate-500">{post.author.verified_specialty}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {post.published_response_count} response
                      {post.published_response_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-slate-900">{post.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
                    {post.clinical_question}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {post.specialty_tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                  </div>
                </button>
              ))}
              {visiblePosts.length === 0 && (
                <EmptyState
                  title="No published discussions yet."
                  detail="Lamina does not insert sample articles or posts when the backend feed is empty."
                />
              )}
            </div>
          </section>

          <section className="mt-10 border-t border-slate-200 pt-8">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-slate-900">Physician Directory</h2>
              <Badge tone="indigo">NPPES-backed search</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Directory records do not imply that a physician joined or authorized Lamina.
            </p>
            <form onSubmit={runDirectorySearch} className="mt-4 flex flex-wrap gap-2">
              <input
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                placeholder="Search physician name or specialty"
                className="min-w-64 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-400"
              />
              <input
                value={directoryState}
                onChange={(event) => setDirectoryState(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="State"
                aria-label="State abbreviation"
                className="w-24 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm uppercase outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={searching || directoryQuery.trim().length < 2}
                className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                {searching ? 'Searching...' : 'Search NPPES'}
              </button>
            </form>

            {selectedPhysician && (
              <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={selectedPhysician.source.toLowerCase() === 'synthetic' ? 'emerald' : 'slate'}>
                    {selectedPhysician.source.toLowerCase() === 'synthetic'
                      ? 'Synthetic Demo Physician'
                      : 'NPPES Directory Profile'}
                  </Badge>
                  <Badge tone={selectedPhysician.agent_status === 'active' ? 'emerald' : 'amber'}>
                    {selectedPhysician.agent_status === 'active'
                      ? 'Active Lamina agent'
                      : `${selectedPhysician.agent_status} agent · inactive`}
                  </Badge>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{selectedPhysician.display_name}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedPhysician.primary_specialty || 'Specialty not listed'}
                  {selectedPhysician.city ? ` · ${selectedPhysician.city}, ${selectedPhysician.state}` : ''}
                </p>
                <p className="mt-2 text-xs text-slate-500">NPI {selectedPhysician.npi}</p>
              </div>
            )}

            <div className="mt-4 space-y-3">
              {directoryResults.map((physician) => (
                <button
                  key={physician.npi}
                  type="button"
                  onClick={() => void openPhysician(physician.npi)}
                  className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{physician.display_name}</div>
                    <div className="text-sm text-slate-500">
                      {physician.primary_specialty || 'Specialty not listed'}
                      {physician.city ? ` · ${physician.city}, ${physician.state}` : ''}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Badge tone={physician.source.toLowerCase() === 'synthetic' ? 'emerald' : 'slate'}>
                      {physician.source.toLowerCase() === 'synthetic' ? 'Synthetic' : 'NPPES'}
                    </Badge>
                    <Badge tone={physician.agent_status === 'active' ? 'emerald' : 'amber'}>
                      {physician.agent_status === 'active' ? 'Active' : 'Unclaimed · reserved'}
                    </Badge>
                  </div>
                </button>
              ))}
              {directoryQuery.trim().length >= 2 && !searching && directoryResults.length === 0 && (
                <p className="text-sm text-slate-500">No physicians matched the submitted search.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
