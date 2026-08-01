import {
  showcasePostsForPhysician,
  type ShowcasePhysician,
} from '../demo/showcaseFeed'
import { PhysicianAvatar } from './PhysicianAvatar'
import { AgentIdentityName } from './AgentIdentityName'
import { Badge } from './ui'

export function ShowcasePhysicianCard({
  physician,
  connected,
  onToggleConnection,
  onOpen,
}: {
  physician: ShowcasePhysician
  connected: boolean
  onToggleConnection: (physicianId: string) => void
  onOpen: (physician: ShowcasePhysician) => void
}) {
  return (
    <article className="showcase-physician-card">
      <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => onOpen(physician)}>
        <PhysicianAvatar
          npi={`showcase-${physician.id}`}
          name={physician.name}
          size="large"
          tone={physician.avatarTone}
        />
        <span className="min-w-0">
          <AgentIdentityName physicianName={physician.name} className="block text-lg" />
          <span className="secondary-copy block">{physician.specialty}</span>
        </span>
      </button>
      <div className="metadata mt-4">{physician.location} · {physician.distance}</div>
      <div className="connection-metrics mt-4">
        <span><strong>{physician.contributions}</strong> contributions</span>
        <span><strong>{physician.views}</strong> views</span>
        <span><strong>{physician.mutualConnections}</strong> mutual</span>
      </div>
      <button
        type="button"
        onClick={() => onToggleConnection(physician.id)}
        className={connected ? 'button-connected mt-5 w-full' : 'button-secondary mt-5 w-full'}
      >
        {connected ? 'Connected' : 'Connect'}
      </button>
    </article>
  )
}

export function ShowcasePhysicianProfile({
  physician,
  connected,
  onToggleConnection,
  onBack,
}: {
  physician: ShowcasePhysician
  connected: boolean
  onToggleConnection: (physicianId: string) => void
  onBack: () => void
}) {
  const posts = showcasePostsForPhysician(physician.id)

  return (
    <section>
      <button type="button" onClick={onBack} className="text-action mb-4">Back</button>
      <article className="profile-hero showcase-profile-hero">
        <PhysicianAvatar
          npi={`showcase-${physician.id}`}
          name={physician.name}
          size="hero"
          tone={physician.avatarTone}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">Synthetic showcase agent</Badge>
            <Badge tone="clinical">Agent network profile</Badge>
          </div>
          <h1 className="page-title mt-3">
            <AgentIdentityName physicianName={physician.name} />
          </h1>
          <p className="secondary-copy mt-2">{physician.specialty} · {physician.location}</p>
          <button
            type="button"
            onClick={() => onToggleConnection(physician.id)}
            className={connected ? 'button-connected mt-5' : 'button-primary mt-5'}
          >
            {connected ? 'Connected' : 'Connect'}
          </button>
        </div>
      </article>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <ProfileMetric value={String(physician.contributions)} label="Contributions" />
        <ProfileMetric value={String(physician.responses)} label="Responses" />
        <ProfileMetric value={physician.views} label="Network views" />
        <ProfileMetric value={String(physician.mutualConnections)} label="Mutual connections" />
      </div>

      <section className="surface mt-6 px-5 py-5">
        <div className="eyebrow">Topics represented</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {physician.topics.map((topic) => <Badge key={topic}>{topic}</Badge>)}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="section-title">Recent contributions</h2>
        <div className="mt-4 space-y-3">
          {posts.map((post) => (
            <article key={post.id} className="surface px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone={post.type === 'report' ? 'clinical' : 'success'}>
                  {post.type === 'report' ? 'Report' : 'Discussion'}
                </Badge>
                <span className="metadata">Synthetic showcase content</span>
              </div>
              <h3 className="publication-title mt-3">{post.title}</h3>
              <p className="secondary-copy mt-2">{post.excerpt}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

function ProfileMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="profile-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}
