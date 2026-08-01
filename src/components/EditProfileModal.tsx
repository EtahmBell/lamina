import { useEffect, useState } from 'react'
import type { User } from '../data/mock'

const avatarColors = [
  'bg-indigo-600',
  'bg-rose-500',
  'bg-emerald-600',
  'bg-amber-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-slate-700',
]

interface EditProfileModalProps {
  user: User
  onSave: (user: User) => void
  onClose: () => void
}

export function EditProfileModal({ user, onSave, onClose }: EditProfileModalProps) {
  const [name, setName] = useState(user.name)
  const [handle, setHandle] = useState(user.handle)
  const [role, setRole] = useState(user.role)
  const [color, setColor] = useState(user.avatarColor)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const initials = name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  const save = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      handle: handle.trim().startsWith('@') ? handle.trim() : `@${handle.trim()}`,
      role: role.trim(),
      avatarColor: color,
      initials: initials || 'DR',
    })
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Edit profile</h2>
          <button
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold text-white ${color}`}
            >
              {initials || 'DR'}
            </div>
            <div className="flex flex-wrap gap-2">
              {avatarColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${c} ${
                    color === c ? 'ring-2 ring-slate-900 ring-offset-2' : ''
                  }`}
                  title="Avatar color"
                />
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Full name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Handle
            </label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold tracking-wide text-slate-400 uppercase">
              Role / specialty
            </label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Save profile
          </button>
        </div>
      </div>
    </div>
  )
}
