import type {
  AgentDetails,
  OrganizationMember,
  OrganizationSummary,
} from '../api/client'
import type { NavKey } from './Sidebar'
import { PhysicianAvatar } from './PhysicianAvatar'
import { Badge } from './ui'

export function RightRail({
  active,
  physician,
  organization,
  members,
}: {
  active: NavKey
  physician: AgentDetails
  organization: OrganizationSummary | null
  members: OrganizationMember[]
}) {
  const pageLabels: Record<NavKey, string> = {
    patients: 'Patient workspace',
    network: 'Physician network',
    reviews: 'Publication review',
    profile: 'Professional profile',
  }

  return (
    <aside className="right-rail" aria-label="Workspace context">
      <section className="rail-card rail-context-card">
        <div className="eyebrow">Current workspace</div>
        <h2 className="publication-title mt-2">{pageLabels[active]}</h2>
        <p className="secondary-copy mt-2">
          {organization?.name ?? 'Independent physician workspace'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone="success">Synthetic demo</Badge>
          <Badge tone="clinical">Approval required</Badge>
        </div>
      </section>

      <section className="rail-card">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title text-lg">Your network</h2>
          <span className="metadata">{members.length} members</span>
        </div>
        <div className="mt-4 space-y-4">
          {members.map((member) => (
            <div key={member.agent_id} className="rail-physician-row">
              <PhysicianAvatar
                npi={member.physician_npi}
                name={member.physician_name}
                size="small"
              />
              <div className="min-w-0 flex-1">
                <div className="physician-name leading-tight font-bold">
                  {member.physician_name}
                </div>
                <div className="metadata mt-0.5 truncate">
                  {member.verified_specialty || 'Specialty not listed'}
                </div>
              </div>
              {member.physician_npi === physician.physician_npi && (
                <span className="rail-you-label">You</span>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="secondary-copy">No organization members were returned.</p>
          )}
        </div>
      </section>

      <section className="rail-card rail-trust-card">
        <div className="eyebrow text-[var(--clinical)]">Clinical safeguards</div>
        <ul className="rail-trust-list mt-3">
          <li>Physicians approve every clinical publication.</li>
          <li>Patient context stays bounded and synthetic.</li>
          <li>Medplum credentials remain server-side.</li>
        </ul>
      </section>
    </aside>
  )
}
