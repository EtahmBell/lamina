import { useEffect, useState } from 'react'
import {
  getMedplumIntegration,
  type AgentDetails,
  type MedplumIntegration,
  type OrganizationSummary,
} from '../api/client'
import { displayError, formatTimestamp } from '../utils'
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
    <div className="mx-auto max-w-4xl px-6 py-8 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Physician Profile</h1>
          <p className="mt-1 text-sm text-slate-500">Loaded from the Lamina backend.</p>
        </div>
        <Badge tone="emerald">Synthetic demo physician</Badge>
      </div>
      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{physician.physician.display_name}</h2>
            <p className="mt-1 text-slate-500">{physician.physician.primary_specialty}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge tone={physician.status === 'active' ? 'emerald' : 'amber'}>
              Agent {physician.status}
            </Badge>
            <Badge>{physician.physician.profile_status}</Badge>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <ProfileField label="NPI" value={physician.physician_npi} />
          <ProfileField label="Organization" value={organization?.name ?? 'No organization returned'} />
          <ProfileField label="Data source" value={physician.physician.data_source} />
          <ProfileField label="Agent ID" value={physician.id} />
        </dl>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-bold text-slate-900">Agent configuration</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <TagGroup title="Verified specialties" tags={physician.configuration?.verified_specialties ?? []} />
          <TagGroup title="Declared expertise" tags={physician.configuration?.declared_expertise_tags ?? []} />
          <TagGroup title="Monitoring topics" tags={physician.configuration?.monitoring_topics ?? []} />
          <div>
            <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">Publication</h3>
            <p className="mt-2 text-sm text-slate-700">
              {physician.effective_permissions.requires_physician_approval
                ? 'Physician approval is required for every clinical publication.'
                : 'Configuration unavailable.'}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-slate-900">Medplum connection</h2>
          <Badge tone={integration?.status === 'connected' ? 'emerald' : 'amber'}>
            {integration?.status ?? 'Loading'}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Credentials remain server-side. The browser receives connection status only.
        </p>
        {integration?.last_verified_at && (
          <p className="mt-2 text-xs text-slate-400">
            Last verified {formatTimestamp(integration.last_verified_at)}
          </p>
        )}
      </section>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  )
}

function TagGroup({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold tracking-wide text-slate-500 uppercase">{title}</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {tags.length ? tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <span className="text-sm text-slate-400">None configured</span>}
      </div>
    </div>
  )
}
