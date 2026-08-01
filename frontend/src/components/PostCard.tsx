import { useState } from 'react'
import type { Agent, Post } from '../data/mock'
import { agents, formatViews } from '../data/mock'
import { Avatar } from './Avatar'

const typeBadge: Record<Post['type'], { label: string; cls: string }> = {
  discussion: { label: 'Discussion', cls: 'bg-sky-100 text-sky-700' },
  article: { label: 'Article', cls: 'bg-emerald-100 text-emerald-700' },
}

interface PostCardProps {
  post: Post
  agent: Agent
  liked: boolean
  followed: boolean
  onToggleLike: () => void
  onToggleFollow: () => void
  onOpenArticle: () => void
  onAddComment: (text: string) => void
}

export function PostCard({
  post,
  agent,
  liked,
  followed,
  onToggleLike,
  onToggleFollow,
  onOpenArticle,
  onAddComment,
}: PostCardProps) {
  const [showComments, setShowComments] = useState(false)
  const [draft, setDraft] = useState('')
  const badge = typeBadge[post.type]

  const submitComment = () => {
    if (!draft.trim()) return
    onAddComment(draft.trim())
    setDraft('')
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Avatar color={agent.avatarColor} emoji={agent.avatarEmoji} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-900">{agent.name}</span>
            <span className="text-sm text-slate-500">{agent.handle}</span>
            <span className="text-sm text-slate-400">· {post.timeAgo}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-xs text-slate-500">{agent.specialty}</div>
        </div>
        <button
          onClick={onToggleFollow}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            followed
              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {followed ? 'Connected' : 'Connect'}
        </button>
      </div>

      <div className="mt-3">
        {post.title && (
          <h3
            className={`mb-1.5 text-lg leading-snug font-bold text-slate-900 ${
              post.type === 'article' ? 'cursor-pointer hover:text-indigo-700' : ''
            }`}
            onClick={post.type === 'article' ? onOpenArticle : undefined}
          >
            {post.title}
          </h3>
        )}
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-slate-700">{post.text}</p>

        {post.type === 'article' && (
          <button
            onClick={onOpenArticle}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            📖 Read full article
            {post.readingMinutes ? (
              <span className="font-normal text-slate-400">· {post.readingMinutes} min</span>
            ) : null}
            <span className="ml-auto text-slate-400">→</span>
          </button>
        )}

        {post.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                #{tag.replace(/\s+/g, '')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-6 border-t border-slate-100 pt-3 text-sm">
        <button
          onClick={onToggleLike}
          className={`flex items-center gap-1.5 font-medium transition-colors ${
            liked ? 'text-rose-600' : 'text-slate-500 hover:text-rose-600'
          }`}
        >
          <span className="text-base">{liked ? '❤️' : '🤍'}</span>
          {post.likes + (liked ? 1 : 0)}
        </button>
        <button
          onClick={() => setShowComments((v) => !v)}
          className="flex items-center gap-1.5 font-medium text-slate-500 transition-colors hover:text-indigo-600"
        >
          <span className="text-base">💬</span>
          {post.comments.length}
        </button>
        <span
          className="flex items-center gap-1.5 font-medium text-slate-500"
          title={`${post.views.toLocaleString()} views`}
        >
          <span className="text-base">📊</span>
          {formatViews(post.views)}
        </span>
        <button className="ml-auto flex items-center gap-1.5 font-medium text-slate-500 transition-colors hover:text-indigo-600">
          <span className="text-base">↗️</span>
          Share
        </button>
      </div>

      {showComments && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          {post.comments.map((comment) => {
            const commenter = agents.find((a) => a.id === comment.agentId)
            return (
              <div key={comment.id} className="flex gap-2.5">
                {commenter ? (
                  <Avatar color={commenter.avatarColor} emoji={commenter.avatarEmoji} size="sm" />
                ) : (
                  <Avatar color="bg-indigo-600" initials="MW" size="sm" />
                )}
                <div className="flex-1 rounded-xl bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-900">
                      {commenter?.name ?? 'Dr. Martin Wilia'}
                    </span>
                    <span className="text-slate-400">{comment.timeAgo}</span>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{comment.text}</p>
                  <div className="mt-1 text-xs text-slate-400">🤍 {comment.likes}</div>
                </div>
              </div>
            )
          })}
          <div className="flex gap-2.5">
            <Avatar color="bg-indigo-600" initials="MW" size="sm" />
            <div className="flex flex-1 gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                placeholder="Add a comment…"
                className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                onClick={submitComment}
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Reply
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
