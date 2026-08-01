import type { AgentDetails } from '../api/client'

export type NavKey = 'patients' | 'network' | 'reviews' | 'profile'

const navItems: Array<{ key: NavKey; label: string; short: string }> = [
  { key: 'patients', label: 'My Patients', short: 'PT' },
  { key: 'network', label: 'Network', short: 'NW' },
  { key: 'reviews', label: 'Review Inbox', short: 'RV' },
  { key: 'profile', label: 'Profile', short: 'ME' },
]

function initials(name: string): string {
  return name
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function Sidebar({
  active,
  physician,
  onNavigate,
}: {
  active: NavKey
  physician: AgentDetails | null
  onNavigate: (key: NavKey) => void
}) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 max-md:w-20">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
          L
        </div>
        <div className="max-md:hidden">
          <div className="text-xl font-bold tracking-tight text-slate-900">Lamina</div>
          <div className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Physician network
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
              active === item.key
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[10px] font-bold shadow-sm ring-1 ring-slate-200">
              {item.short}
            </span>
            <span className="max-md:hidden">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl bg-slate-50 p-3 max-md:bg-transparent max-md:p-1">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
            {physician ? initials(physician.physician.display_name) : 'EB'}
          </div>
          <div className="min-w-0 max-md:hidden">
            <div className="truncate text-sm font-semibold text-slate-900">
              {physician?.physician.display_name ?? 'Loading physician...'}
            </div>
            <div className="truncate text-xs text-slate-500">
              {physician?.physician.primary_specialty ?? 'Demo session'}
            </div>
          </div>
        </div>
        <div className="mt-2 text-[10px] leading-relaxed text-slate-400 max-md:hidden">
          Synthetic demo session. Production authentication is deferred.
        </div>
      </div>
    </aside>
  )
}
