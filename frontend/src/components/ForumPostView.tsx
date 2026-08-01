import type { ForumPost, ForumResponse } from '../api/client'
import { formatTimestamp } from '../utils'
import { Badge } from './ui'

function ResponseView({ response }: { response: ForumResponse }) {
  const grounding = response.provenance.grounding
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <div className="font-semibold text-slate-900">{response.author.physician_name}</div>
          <div className="text-xs text-slate-500">{response.author.verified_specialty}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {response.provenance.physician_approved && (
            <Badge tone="emerald">Physician approved</Badge>
          )}
          {grounding.source_system === 'medplum' && (
            <Badge tone="indigo">Grounded in Medplum</Badge>
          )}
          {grounding.matched_case_count > 0 && (
            <Badge>
              {grounding.matched_case_count} similar case
              {grounding.matched_case_count === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </div>
      <h4 className="mt-3 font-bold text-slate-900">{response.headline}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
        {response.content}
      </p>
    </article>
  )
}

export function ForumPostView({ post }: { post: ForumPost }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <div className="font-semibold text-slate-900">{post.author.physician_name}</div>
          <div className="text-sm text-slate-500">
            {post.author.verified_specialty}
            {post.author.organization ? ` · ${post.author.organization}` : ''}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {post.provenance.draft_origin === 'agent_generated' && (
            <Badge tone="indigo">AI drafted</Badge>
          )}
          {post.provenance.grounding?.source_system === 'medplum' && (
            <Badge tone="indigo">Grounded in Medplum</Badge>
          )}
          {post.provenance.physician_approved ? (
            <Badge tone="emerald">Physician approved</Badge>
          ) : (
            <Badge tone="amber">Awaiting physician approval</Badge>
          )}
        </div>
      </div>

      <h3 className="mt-4 text-xl font-bold text-slate-900">{post.title}</h3>
      <p className="mt-2 font-medium leading-relaxed text-slate-800">
        {post.clinical_question}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
        {post.context_summary}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {post.specialty_tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-400">
        {post.status === 'published' ? 'Published' : 'Drafted'} {formatTimestamp(
          post.published_at ?? post.created_at,
        )}
      </div>

      {post.responses.length > 0 && (
        <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
          <h4 className="text-sm font-bold tracking-wide text-slate-500 uppercase">
            Physician responses
          </h4>
          {post.responses.map((response) => (
            <ResponseView key={response.id} response={response} />
          ))}
        </div>
      )}
    </article>
  )
}
