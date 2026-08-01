import type { AgentDetails } from '../api/client'
import { Brand } from './Brand'
import { PhysicianAvatar } from './PhysicianAvatar'

export type NavKey = 'patients' | 'network' | 'reviews' | 'profile'

const navItems: Array<{ key: NavKey; label: string; hint: string }> = [
  { key: 'patients', label: 'Patients', hint: 'Clinical workspace' },
  { key: 'network', label: 'Network', hint: 'Physician discussion' },
  { key: 'reviews', label: 'Review', hint: 'Approval queue' },
  { key: 'profile', label: 'Profile', hint: 'Identity & settings' },
]

export function Sidebar({
  active,
  physician,
  organizationName,
  onNavigate,
  onSignOut,
}: {
  active: NavKey
  physician: AgentDetails | null
  organizationName: string | null
  onNavigate: (key: NavKey) => void
  onSignOut: () => void
}) {
  return (
    <aside className="left-sidebar">
      <div className="border-b border-[var(--border)] px-2 pb-6 max-md:px-0 max-md:text-center">
        <div className="max-md:[&_.wordmark]:hidden">
          <Brand />
        </div>
        <div className="mt-1 text-[10px] font-bold tracking-[0.12em] text-[var(--text-secondary)] uppercase max-md:hidden">
          Physician network
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-1.5" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={active === item.key ? 'page' : undefined}
            onClick={() => onNavigate(item.key)}
            className={`sidebar-nav-item ${active === item.key ? 'sidebar-nav-item-active' : ''}`}
          >
            <span>{item.label}</span>
            <span className="sidebar-nav-hint">{item.hint}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto border-t border-[var(--border)] px-2 pt-5 max-md:px-0">
        <div className="flex items-center gap-3 max-md:justify-center">
          {physician && (
            <PhysicianAvatar
              npi={physician.physician_npi}
              name={physician.physician.display_name}
              size="small"
            />
          )}
          <div className="min-w-0 max-md:hidden">
            <div className="physician-name truncate text-base font-bold leading-tight">
              {physician?.physician.display_name ?? 'Loading'}
            </div>
            <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
              {physician?.physician.primary_specialty ?? 'Demo session'}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[10px] leading-relaxed text-[var(--text-secondary)] max-md:hidden">
          {organizationName && <>{organizationName}<br /></>}
          Synthetic demo session
        </div>
        <button type="button" onClick={onSignOut} className="text-action mt-3 max-md:text-[11px]">
          <span className="max-md:hidden">Switch physician / Sign out</span>
          <span className="hidden max-md:inline">Exit</span>
        </button>
      </div>
    </aside>
  )
}
