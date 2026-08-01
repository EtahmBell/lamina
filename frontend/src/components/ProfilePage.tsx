import { useEffect, useState } from 'react'
import {
  getMedplumIntegration,
  type AgentDetails,
  type MedplumIntegration,
  type OrganizationSummary,
} from '../api/client'
import { displayError, formatTimestamp } from '../utils'
import { PhysicianAvatar } from './PhysicianAvatar'
import { Badge, ErrorBanner } from './ui'

export function ProfilePage({
  physician,
  organization,
}: {
  physician: AgentDetails
  organization: OrganizationSummary | null
}) {
  const [integration, setIntegration] = useState<MedplumIntegration | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!organization) return
    getMedplumIntegration(organization.id).then(setIntegration).catch((loadError) => {
      setError(displayError(loadError))
    })
  }, [organization])

  return (
    <div className="page-shell">
      <header className="profile-hero">
        <PhysicianAvatar
          npi={physician.physician_npi}
          name={physician.physician.display_name}
          size="hero"
        />
        <div className="min-w-0 flex-1">
        <div className="eyebrow">Professional directory</div>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div>
            <h1 className="page-title">{physician.physician.display_name}</h1>
            <p className="mt-2 text-base text-[var(--text-secondary)]">
              {physician.physician.primary_specialty}
              {organization ? ` · ${organization.name}` : ''}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge tone="success">Synthetic demo physician</Badge>
            <Badge tone={physician.status === 'active' ? 'success' : 'warning'}>
              Lamina {physician.status}
            </Badge>
          </div>
        </div>
        </div>
      </header>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <section className="mt-7">
        <h2 className="section-title">Practice and identity</h2>
        <dl className="surface mt-4 grid divide-y divide-[var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="divide-y divide-[var(--border)]">
            <ProfileField label="NPI" value={physician.physician_npi} />
            <ProfileField label="Organization" value={organization?.name ?? 'No organization returned'} />
          </div>
          <div className="divide-y divide-[var(--border)]">
            <ProfileField label="Profile source" value={physician.physician.data_source} />
            <ProfileField label="Profile status" value={physician.physician.profile_status} />
          </div>
        </dl>
      </section>

      <section className="section-rule mt-8 pt-7">
        <h2 className="section-title">Clinical activity settings</h2>
        <div className="mt-4 grid gap-x-8 gap-y-6 md:grid-cols-2">
          <TagGroup title="Verified specialties" tags={physician.configuration?.verified_specialties ?? []} />
          <TagGroup title="Declared expertise" tags={physician.configuration?.declared_expertise_tags ?? []} />
          <TagGroup title="Monitoring topics" tags={physician.configuration?.monitoring_topics ?? []} />
          <div>
            <h3 className="eyebrow text-[var(--clinical)]">Publication policy</h3>
            <p className="secondary-copy mt-2 text-[var(--text-primary)]">
              {physician.effective_permissions.requires_physician_approval
                ? 'Physician approval is required for every clinical publication.'
                : 'Configuration unavailable.'}
            </p>
          </div>
        </div>
      </section>

      <section className="section-rule mt-8 pt-7">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title">Clinical data connection</h2>
          <Badge tone={integration?.status === 'connected' ? 'success' : 'warning'}>
            Medplum {integration?.status ?? 'loading'}
          </Badge>
        </div>
        <p className="secondary-copy mt-2">
          Credentials remain server-side. The browser receives connection status only.
        </p>
        {integration?.last_verified_at && (
          <p className="metadata mt-2">Last verified {formatTimestamp(integration.last_verified_at)}</p>
        )}
      </section>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="metadata font-bold tracking-[0.08em] uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}

function TagGroup({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div>
      <h3 className="eyebrow text-[var(--clinical)]">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.length
          ? tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
          : <span className="secondary-copy">None configured</span>}
      </div>
    </div>
  )
}
