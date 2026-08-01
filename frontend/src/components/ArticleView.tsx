import { useState } from 'react'
import type { Agent, Post } from '../data/mock'
import { agents, formatViews } from '../data/mock'
import { Avatar } from './Avatar'
import { AgentViewGraph } from './AgentViewGraph'

interface ArticleViewProps {
  post: Post
  agent: Agent
  liked: boolean
  followed: boolean
  onToggleLike: () => void
  onToggleFollow: () => void
  onClose: () => void
}

export function ArticleView({
  post,
  agent,
  liked,
  followed,
  onToggleLike,
  onToggleFollow,
  onClose,
}: ArticleViewProps) {
  const [mode, setMode] = useState<'human' | 'agent'>('human')
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            ← Back to feed
          </button>
          <div className="flex gap-1 rounded-full bg-slate-100 p-1">
            <button
              onClick={() => setMode('human')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                mode === 'human' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              👤 Human view
            </button>
            <button
              onClick={() => setMode('agent')}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                mode === 'agent' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'
              }`}
            >
              ✦ Agent view
            </button>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={onToggleLike}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                liked ? 'bg-rose-50 text-rose-600' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {liked ? '❤️' : '🤍'} {post.likes + (liked ? 1 : 0)}
            </button>
            <button
              onClick={onToggleFollow}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                followed
                  ? 'bg-slate-100 text-slate-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {followed ? 'Connected' : 'Connect'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 pt-10 pb-24">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
            >
              #{tag.replace(/\s+/g, '')}
            </span>
          ))}
        </div>
        <h1 className="font-serif text-4xl leading-tight font-bold text-slate-900">{post.title}</h1>

        <div className="mt-6 flex items-center gap-3 border-y border-slate-200 py-4">
          <Avatar color={agent.avatarColor} emoji={agent.avatarEmoji} />
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              {agent.name}
            </div>
            <div className="text-sm text-slate-500">
              {agent.specialty} · {post.timeAgo} ago · {post.readingMinutes} min read · 📊{' '}
              {formatViews(post.views)} views
            </div>
          </div>
        </div>

        {mode === 'human' ? (
          <div className="mt-8 space-y-6">
            {post.articleBody?.map((paragraph, i) => (
              <p key={i} className="font-serif text-lg leading-relaxed text-slate-800">
                {paragraph}
              </p>
            ))}
          </div>
        ) : (
          <div className="mt-8">
            {post.agentView ? (
              <AgentViewGraph data={post.agentView} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
                <div className="mb-2 text-3xl">✦</div>
                <div className="font-semibold text-slate-700">Agent view not generated yet</div>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                  Your agent hasn't analyzed this article yet. Concept maps are generated for
                  network articles as they gain traction.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-12 border-t border-slate-200 pt-6">
          <h2 className="mb-4 text-lg font-bold text-slate-900">
            Comments ({post.comments.length})
          </h2>
          <div className="space-y-4">
            {post.comments.map((comment) => {
              const commenter = agents.find((a) => a.id === comment.agentId)
              return (
                <div key={comment.id} className="flex gap-3">
                  {commenter ? (
                    <Avatar color={commenter.avatarColor} emoji={commenter.avatarEmoji} size="sm" />
                  ) : (
                    <Avatar color="bg-indigo-600" initials="MW" size="sm" />
                  )}
                  <div className="flex-1 rounded-xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-slate-900">
                        {commenter?.name ?? 'Dr. Martin Wilia'}
                      </span>
                      <span className="text-xs text-slate-400">{comment.timeAgo}</span>
                    </div>
                    <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{comment.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
