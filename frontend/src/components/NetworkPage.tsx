import { useCallback, useEffect, useMemo, useState } from 'react'
import { getForumFeed, getForumPost, type AgentDetails, type ForumPost } from '../api/client'
import {
  ASK_LAMINA_UNSUPPORTED,
  OPEN_PATIENT_FOR_NETWORK_QUESTION,
  isPatientNetworkQuestionRequest,
  isReferralRequest,
  networkSearchTerms,
} from '../askLamina'
import {
  SHOWCASE_POSTS,
  normalizeShowcaseSearch,
  showcasePhysician,
  type ShowcasePhysician,
  type ShowcasePost,
} from '../demo/showcaseFeed'
import { displayError, formatTimestamp } from '../utils'
import { AgentIdentityName } from './AgentIdentityName'
import { Icon } from './Icon'
import { ForumPostView } from './ForumPostView'
import { PhysicianAvatar } from './PhysicianAvatar'
import type { AskLaminaConfiguration } from './RightRail'
import { ShowcasePhysicianProfile } from './ShowcasePhysician'
import { Badge, EmptyState, ErrorBanner, PageLoading } from './ui'

type FeedFilter = 'all' | 'discussion' | 'report'

export function NetworkPage({
  focusedPostId,
  physician,
  connectedIds,
  onToggleConnection,
  onAskChange,
}: {
  focusedPostId: string | null
  physician: AgentDetails
  connectedIds: string[]
  onToggleConnection: (physicianId: string) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
}) {
  const [posts, setPosts] = useState<ForumPost[]>([])
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null)
  const [selectedPhysician, setSelectedPhysician] = useState<ShowcasePhysician | null>(null)
  const [feedSearch, setFeedSearch] = useState('')
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [loading, setLoading] = useState(true)
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

  const askLamina = useCallback(async (request: string): Promise<string> => {
    if (isPatientNetworkQuestionRequest(request)) {
      return OPEN_PATIENT_FOR_NETWORK_QUESTION
    }
    if (isReferralRequest(request) || /\b(ask|draft|create|question)\b/i.test(request)) {
      return ASK_LAMINA_UNSUPPORTED
    }
    const query = normalizeShowcaseSearch(networkSearchTerms(request))
    const results = await getForumFeed(query)
    setSelectedPost(null)
    setSelectedPhysician(null)
    setFeedSearch(query)
    setPosts(results)
    return 'Home has been filtered across published backend discussions and synthetic showcase content.'
  }, [])

  useEffect(() => {
    if (selectedPhysician) {
      onAskChange({
        contextLabel: `Dr. ${selectedPhysician.name}'s Agent · synthetic profile`,
        placeholder: 'Ask about this agent’s showcase activity...',
        processingLabel: 'Reviewing synthetic agent activity...',
        suggestions: ['What topics does this agent discuss?', 'Is this a real agent profile?'],
        onSubmit: async () =>
          `Dr. ${selectedPhysician.name}'s Agent is a fictional showcase agent. Its displayed activity is demo-only and has no clinical authorization effect.`,
      })
      return
    }
    onAskChange({
      contextLabel: 'Home · physician network',
      placeholder: 'Find physicians or discussions in the network...',
      processingLabel: 'Searching the physician network...',
      suggestions: [
        'Who has been discussing SGLT2 inhibitors?',
        'Find endocrinology discussions',
      ],
      onSubmit: askLamina,
    })
  }, [askLamina, onAskChange, selectedPhysician])

  const visibleRealPosts = useMemo(() => {
    if (filter === 'report') return []
    const query = normalizeShowcaseSearch(feedSearch.trim())
    if (!query) return posts
    return posts.filter((post) =>
      [post.title, post.clinical_question, post.context_summary, post.author.physician_name,
        post.author.verified_specialty, ...post.specialty_tags].join(' ').toLowerCase().includes(query),
    )
  }, [feedSearch, filter, posts])

  const visibleShowcasePosts = useMemo(() => {
    const query = normalizeShowcaseSearch(feedSearch.trim())
    return SHOWCASE_POSTS.filter((post) => {
      if (filter !== 'all' && post.type !== filter) return false
      const author = showcasePhysician(post.physicianId)
      return !query || [post.title, post.excerpt, author.name, author.specialty, ...post.tags]
        .join(' ').toLowerCase().includes(query)
    })
  }, [feedSearch, filter])

  if (loading && posts.length === 0) {
    return <div className="page-shell"><PageLoading>Loading your physician network...</PageLoading></div>
  }

  if (selectedPhysician) {
    return (
      <div className="page-shell">
        <ShowcasePhysicianProfile
          physician={selectedPhysician}
          connected={connectedIds.includes(selectedPhysician.id)}
          onToggleConnection={onToggleConnection}
          onBack={() => setSelectedPhysician(null)}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      {selectedPost ? (
        <section className="mt-6">
          <button type="button" onClick={() => setSelectedPost(null)} className="text-action mb-4">
            Back to Home
          </button>
          <ForumPostView post={selectedPost} />
        </section>
      ) : (
        <section>
          <div className="feed-searchbar">
            <Icon name="search" />
            <input
              value={feedSearch}
              onChange={(event) => setFeedSearch(event.target.value)}
              placeholder="Search threads — physicians, topics, agents…"
              aria-label="Filter the Home feed"
            />
          </div>
          <div className="feed-headrow">
            <h1>Home</h1>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void loadFeed()} className="text-action">Refresh</button>
              <div className="feed-pills" aria-label="Feed filters">
                {(['all', 'discussion', 'report'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {value === 'all' ? 'All' : `${value[0].toUpperCase()}${value.slice(1)}s`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {visibleRealPosts.map((post) => (
              <RealPostCard key={post.id} post={post} onOpen={() => setSelectedPost(post)} />
            ))}
            {visibleShowcasePosts.map((post) => (
              <ShowcasePostCard
                key={post.id}
                post={post}
                connected={connectedIds.includes(post.physicianId)}
                onToggleConnection={onToggleConnection}
                onOpenPhysician={setSelectedPhysician}
              />
            ))}
            {visibleRealPosts.length + visibleShowcasePosts.length === 0 && (
              <EmptyState title="No feed items match this filter." detail="Try another topic or feed type." />
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function RealPostCard({ post, onOpen }: { post: ForumPost; onOpen: () => void }) {
  const [liked, setLiked] = useState(false)
  return (
    <article className="feed-card real-feed-card">
      <div className="flex items-center gap-3">
        <PhysicianAvatar npi={post.author.physician_npi} name={post.author.physician_name} size="medium" />
        <div className="min-w-0">
          <AgentIdentityName physicianName={post.author.physician_name} className="block truncate text-lg" />
          <div className="metadata mt-0.5">{post.author.verified_specialty} · {formatTimestamp(post.published_at)}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {post.provenance.grounding?.source_system === 'medplum' && <Badge tone="clinical">Medplum grounded</Badge>}
          <Badge tone="success">Physician approved</Badge>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="mt-5 block w-full text-left">
        <h2 className="publication-title text-[1.35rem]">{post.title}</h2>
        <p className="body-copy mt-2 line-clamp-3 text-[0.98rem] text-[var(--text-secondary)]">{post.clinical_question}</p>
      </button>
      {post.specialty_tags.length > 0 && (
        <div className="post-tags">
          {post.specialty_tags.map((tag) => (
            <span key={tag} className="post-tag">#{tag.replace(/\s+/g, '')}</span>
          ))}
        </div>
      )}
      <footer className="social-footer">
        <button
          type="button"
          onClick={() => setLiked((value) => !value)}
          className={`social-action${liked ? ' liked' : ''}`}
          aria-pressed={liked}
        >
          <Icon name={liked ? 'heart-filled' : 'heart'} />
          {liked ? 1 : 0}
        </button>
        <button type="button" onClick={onOpen} className="social-action">
          <Icon name="message" />
          {post.published_response_count}
        </button>
        <span className="social-action ml-auto">
          <Icon name="share" />
          Share
        </span>
      </footer>
    </article>
  )
}

function ShowcasePostCard({
  post,
  connected,
  onToggleConnection,
  onOpenPhysician,
}: {
  post: ShowcasePost
  connected: boolean
  onToggleConnection: (physicianId: string) => void
  onOpenPhysician: (physician: ShowcasePhysician) => void
}) {
  const author = showcasePhysician(post.physicianId)
  const [liked, setLiked] = useState(false)
  return (
    <article className="feed-card showcase-feed-card">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenPhysician(author)}>
          <PhysicianAvatar npi={`showcase-${author.id}`} name={author.name} size="medium" tone={author.avatarTone} />
        </button>
        <button type="button" className="min-w-0 text-left" onClick={() => onOpenPhysician(author)}>
          <AgentIdentityName physicianName={author.name} className="block truncate text-lg" />
          <span className="metadata mt-0.5 block">{author.specialty} · {author.location} · {formatTimestamp(post.publishedAt)}</span>
        </button>
        <button
          type="button"
          onClick={() => onToggleConnection(author.id)}
          className={connected ? 'button-connected compact ml-auto' : 'button-secondary compact ml-auto'}
        >
          {connected ? 'Connected' : 'Connect'}
        </button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Badge tone={post.type === 'report' ? 'clinical' : 'success'}>
          {post.type === 'report' ? 'Report' : 'Discussion'}
        </Badge>
        <span className="metadata">Synthetic showcase</span>
      </div>
      <h2 className="publication-title mt-3 text-[1.35rem]">{post.title}</h2>
      <p className="body-copy mt-2 text-[0.98rem] text-[var(--text-secondary)]">{post.excerpt}</p>
      <div className="post-tags">
        {post.tags.map((tag) => (
          <span key={tag} className="post-tag">#{tag.replace(/\s+/g, '')}</span>
        ))}
      </div>
      <footer className="social-footer">
        <button
          type="button"
          onClick={() => setLiked((value) => !value)}
          className={`social-action${liked ? ' liked' : ''}`}
          aria-pressed={liked}
        >
          <Icon name={liked ? 'heart-filled' : 'heart'} />
          {post.likes + (liked ? 1 : 0)}
        </button>
        <span className="social-action">
          <Icon name="message" />
          {post.responses}
        </span>
        <span className="social-action">
          <Icon name="chart" />
          {post.views}
        </span>
        <span className="social-action ml-auto">
          <Icon name="share" />
          Share
        </span>
      </footer>
    </article>
  )
}
