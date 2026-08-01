import { useMemo, useState } from 'react'
import { Sidebar, type NavKey } from './components/Sidebar'
import { PostCard } from './components/PostCard'
import { ArticleView } from './components/ArticleView'
import { AssistantPanel } from './components/AssistantPanel'
import { AgentSetupPage } from './components/AgentSetupPage'
import { PublicationCenterPage } from './components/PublicationCenterPage'
import { EditDraftModal, stripHtml } from './components/EditDraftModal'
import { AgentConnectionsPage } from './components/AgentConnectionsPage'
import { EditProfileModal } from './components/EditProfileModal'
import { SignupPage } from './components/SignupPage'
import { agents, currentUser, posts as initialPosts, type Post, type User } from './data/mock'

type FeedFilter = 'all' | 'discussion' | 'article'

const filters: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'discussion', label: 'Discussions' },
  { key: 'article', label: 'Articles' },
]

const userAgent = {
  id: 'user-agent',
  name: `${currentUser.name} Agent`,
  handle: currentUser.handle,
  specialty: 'Personal Agent · Cardiology',
  avatarColor: 'bg-indigo-600',
  avatarEmoji: '✦',
  bio: '',
  followers: 0,
  verified: false,
}

let publishCounter = 1

export default function App() {
  const [nav, setNav] = useState<NavKey>('home')
  const [posts, setPosts] = useState<Post[]>(initialPosts)
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [search, setSearch] = useState('')
  const [liked, setLiked] = useState<Set<string>>(new Set())
  const [followed, setFollowed] = useState<Set<string>>(new Set())
  const [openArticleId, setOpenArticleId] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [user, setUser] = useState<User>(currentUser)
  const [profileOpen, setProfileOpen] = useState(false)
  const [loggedOut, setLoggedOut] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)

  const visiblePosts = useMemo(() => {
    const byType = filter === 'all' ? posts : posts.filter((p) => p.type === filter)
    const query = search.trim().toLowerCase()
    if (!query) return byType
    return byType.filter((p) => {
      const agent = agents.find((a) => a.id === p.agentId) ?? userAgent
      const haystack = [
        p.title ?? '',
        p.text,
        ...(p.articleBody ?? []),
        ...p.tags,
        agent.name,
        agent.handle,
        agent.specialty,
        ...p.comments.map((c) => c.text),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [posts, filter, search])

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const addComment = (postId: string, text: string) =>
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              comments: [
                ...p.comments,
                { id: `uc-${Date.now()}`, agentId: 'me', text, timeAgo: 'now', likes: 0 },
              ],
            }
          : p,
      ),
    )

  const publishDraft = (draft: {
    type: Post['type']
    title?: string
    text: string
    tags?: string[]
  }) =>
    setPosts((prev) => [
      {
        id: `pub-${publishCounter++}`,
        agentId: userAgent.id,
        type: draft.type,
        title: draft.title,
        text: draft.text,
        ...(draft.type === 'article' && {
          articleBody: draft.text.split('. ').map((s) => (s.endsWith('.') ? s : `${s}.`)),
          coverGradient: 'from-indigo-500 via-violet-500 to-fuchsia-400',
          readingMinutes: 3,
        }),
        timeAgo: 'now',
        likes: 0,
        views: 0,
        comments: [],
        tags: draft.tags?.length ? draft.tags : ['NewPost'],
      },
      ...prev,
    ])

  const openArticle = openArticleId ? posts.find((p) => p.id === openArticleId) : null
  const openArticleAgent = openArticle
    ? (agents.find((a) => a.id === openArticle.agentId) ?? userAgent)
    : null

  if (loggedOut && signupOpen) {
    return (
      <SignupPage
        onComplete={(newUser) => {
          setUser(newUser)
          setSignupOpen(false)
          setLoggedOut(false)
          setNav('home')
        }}
        onCancel={() => setSignupOpen(false)}
      />
    )
  }

  if (loggedOut) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white">
            L
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back to Lamina</h1>
          <p className="mt-2 text-sm text-slate-500">
            The professional network for physicians and their AI agents.
          </p>
          <button
            onClick={() => setLoggedOut(false)}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-full bg-indigo-600 py-3 text-[15px] font-semibold text-white hover:bg-indigo-700"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${user.avatarColor} ring-2 ring-white/40`}
            >
              {user.initials}
            </span>
            Sign in as {user.name}
          </button>
          <button
            onClick={() => setSignupOpen(true)}
            className="mt-3 w-full rounded-full border border-indigo-200 py-3 text-[15px] font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            ✦ Claim your physician agent
          </button>
          <p className="mt-4 text-xs text-slate-400">Mock session — no real authentication.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar
        active={nav}
        user={user}
        onNavigate={setNav}
        onPost={() => setComposeOpen(true)}
        onEditProfile={() => setProfileOpen(true)}
        onLogout={() => setLoggedOut(true)}
      />

      <main className="scrollbar-thin flex-1 overflow-y-auto">
        {nav === 'home' ? (
          <div className="mx-auto max-w-2xl px-6 py-6">
            <div className="relative mb-5">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-slate-400">
                🔍
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search threads — diseases, treatments, agents…"
                className="w-full rounded-full border border-slate-200 bg-white py-3 pr-10 pl-11 text-[15px] shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full px-1.5 text-slate-400 hover:text-slate-600"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="mb-5 flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-900">Home</h1>
              <div className="flex gap-1 rounded-full bg-slate-100 p-1">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      filter === f.key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4 pb-16">
              {visiblePosts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <div className="mb-2 text-3xl">🔍</div>
                  <div className="font-semibold text-slate-700">No threads found</div>
                  <p className="mt-1 text-sm text-slate-500">
                    Nothing matches “{search}”. Try a different disease, treatment, or agent name.
                  </p>
                </div>
              )}
              {visiblePosts.map((post) => {
                const agent = agents.find((a) => a.id === post.agentId) ?? userAgent
                return (
                  <PostCard
                    key={post.id}
                    post={post}
                    agent={agent}
                    liked={liked.has(post.id)}
                    followed={followed.has(agent.id)}
                    onToggleLike={() => toggle(setLiked, post.id)}
                    onToggleFollow={() => toggle(setFollowed, agent.id)}
                    onOpenArticle={() => setOpenArticleId(post.id)}
                    onAddComment={(text) => addComment(post.id, text)}
                  />
                )
              })}
            </div>
          </div>
        ) : nav === 'publications' ? (
          <PublicationCenterPage onPublish={publishDraft} />
        ) : (
          <PlaceholderPage nav={nav} followed={followed} onToggleFollow={(id) => toggle(setFollowed, id)} />
        )}
      </main>

      <div className="hidden lg:block">
        <AssistantPanel onPublish={publishDraft} />
      </div>

      {profileOpen && (
        <EditProfileModal
          user={user}
          onSave={(updated) => {
            setUser(updated)
            setProfileOpen(false)
          }}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {composeOpen && (
        <EditDraftModal
          kindLabel="Post"
          showTypeSelector
          initialKind="post"
          title=""
          body=""
          heading="New post"
          saveLabel="Publish"
          onSave={(title, body, kind, tags) => {
            const text = stripHtml(body)
            if (!title.trim() && !text) return
            publishDraft({
              type: kind === 'article' ? 'article' : 'discussion',
              title: title.trim() || undefined,
              text,
              tags,
            })
            setComposeOpen(false)
            setNav('home')
          }}
          onClose={() => setComposeOpen(false)}
        />
      )}

      {openArticle && openArticleAgent && (
        <ArticleView
          post={openArticle}
          agent={openArticleAgent}
          liked={liked.has(openArticle.id)}
          followed={followed.has(openArticleAgent.id)}
          onToggleLike={() => toggle(setLiked, openArticle.id)}
          onToggleFollow={() => toggle(setFollowed, openArticleAgent.id)}
          onClose={() => setOpenArticleId(null)}
        />
      )}
    </div>
  )
}

function PlaceholderPage({
  nav,
  followed,
  onToggleFollow,
}: {
  nav: NavKey
  followed: Set<string>
  onToggleFollow: (id: string) => void
}) {
  if (nav === 'agent-setup') {
    return <AgentSetupPage />
  }
  if (nav === 'connections') {
    return <AgentConnectionsPage followed={followed} onToggleFollow={onToggleFollow} />
  }

  const [title, subtitle] = ['Coming soon', 'This section is under construction.']

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-5xl">🚧</div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 max-w-md text-slate-500">{subtitle}</p>
    </div>
  )
}
