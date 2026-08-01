import type { ForumPost, ForumResponse } from '../api/client'
import { formatTimestamp } from '../utils'
import { Badge } from './ui'
import { AgentIdentityName } from './AgentIdentityName'
import { PhysicianAvatar } from './PhysicianAvatar'

function ResponseView({ response }: { response: ForumResponse }) {
  const grounding = response.provenance.grounding
  return (
    <article className="response-card">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <PhysicianAvatar
          npi={response.author.physician_npi}
          name={response.author.physician_name}
          size="small"
        />
        <div>
          <AgentIdentityName physicianName={response.author.physician_name} className="block text-lg" />
          <div className="metadata mt-0.5">{response.author.verified_specialty}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {response.provenance.physician_approved && (
            <Badge tone="success">Physician approved</Badge>
          )}
          {grounding.source_system === 'medplum' && (
            <Badge tone="clinical">Grounded in Medplum</Badge>
          )}
          {grounding.matched_case_count > 0 && (
            <Badge>
              {grounding.matched_case_count} similar case
              {grounding.matched_case_count === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </div>
      <h4 className="publication-title mt-4">{response.headline}</h4>
      <p className="body-copy mt-2 whitespace-pre-wrap">{response.content}</p>
    </article>
  )
}

export function ForumPostView({ post }: { post: ForumPost }) {
  return (
    <article className="forum-post-document">
      <header className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          <PhysicianAvatar
            npi={post.author.physician_npi}
            name={post.author.physician_name}
            size="medium"
          />
          <div>
            <AgentIdentityName physicianName={post.author.physician_name} className="block text-xl" />
            <div className="secondary-copy mt-0.5">
              {post.author.verified_specialty}
              {post.author.organization ? ` · ${post.author.organization}` : ''}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {post.provenance.draft_origin === 'agent_generated' && (
              <Badge>Draft prepared</Badge>
            )}
            {post.provenance.grounding?.source_system === 'medplum' && (
              <Badge tone="clinical">Grounded in Medplum</Badge>
            )}
            {post.provenance.physician_approved ? (
              <Badge tone="success">Physician approved</Badge>
            ) : (
              <Badge tone="warning">Awaiting physician approval</Badge>
            )}
          </div>
        </div>
      </header>

      <h3 className="publication-title mt-6 text-[1.45rem]">{post.title}</h3>
      <p className="body-copy mt-3 font-semibold">{post.clinical_question}</p>
      <p className="body-copy mt-3 text-[var(--text-secondary)]">{post.context_summary}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {post.specialty_tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
      </div>
      <div className="metadata mt-4">
        {post.status === 'published' ? 'Published' : 'Drafted'} {formatTimestamp(
          post.published_at ?? post.created_at,
        )}
      </div>

      {post.responses.length > 0 && (
        <section className="section-rule mt-7 pt-6">
          <h4 className="eyebrow text-[var(--clinical)]">Physician responses</h4>
          <div className="mt-5 space-y-7">
            {post.responses.map((response) => (
              <ResponseView key={response.id} response={response} />
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
