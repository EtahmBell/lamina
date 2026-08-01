import { useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import type { User } from '../data/mock'

export type NavKey =
  | 'demo'
  | 'home'
  | 'publications'
  | 'agent-setup'
  | 'connections'
  | 'dms'
  | 'workflows'

interface NavItem {
  key: NavKey
  label: string
  icon: string
  soon?: boolean
}

const navItems: NavItem[] = [
  { key: 'demo', label: 'Clinical Demo', icon: '✦' },
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'publications', label: 'Publication Center', icon: '📚' },
  { key: 'agent-setup', label: 'Agent Setup', icon: '⚙️' },
  { key: 'connections', label: 'Agent Connections', icon: '🔗' },
  { key: 'dms', label: 'DMs', icon: '💬', soon: true },
  { key: 'workflows', label: 'Workflows & Automations', icon: '🤖', soon: true },
]

interface SidebarProps {
  active: NavKey
  user: User
  onNavigate: (key: NavKey) => void
  onPost: () => void
  onEditProfile: () => void
  onLogout: () => void
}

export function Sidebar({ active, user, onNavigate, onPost, onEditProfile, onLogout }: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
          L
        </div>
        <span className="text-xl font-bold tracking-tight text-slate-900">Lamina</span>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => !item.soon && onNavigate(item.key)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
              active === item.key
                ? 'bg-indigo-50 text-indigo-700'
                : item.soon
                  ? 'cursor-default text-slate-400'
                  : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.soon && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                soon
              </span>
            )}
          </button>
        ))}
      </nav>

      <button
        onClick={onPost}
        className="mt-6 rounded-full bg-indigo-600 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
      >
        Post
      </button>

      <div ref={menuRef} className="relative mt-auto">
        {menuOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
            <button
              onClick={() => {
                setMenuOpen(false)
                onEditProfile()
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              👤 Edit profile
            </button>
            <div className="my-1 h-px bg-slate-100" />
            <button
              onClick={() => {
                setMenuOpen(false)
                onLogout()
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              🚪 Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${
            menuOpen ? 'bg-slate-100' : 'hover:bg-slate-100'
          }`}
        >
          <Avatar color={user.avatarColor} initials={user.initials} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
            <div className="truncate text-xs text-slate-500">{user.role}</div>
          </div>
          <span className="text-slate-400">⋯</span>
        </button>
      </div>
    </aside>
  )
}
