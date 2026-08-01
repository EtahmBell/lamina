export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode
  tone?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose'
}) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-800',
    rose: 'bg-rose-100 text-rose-700',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>
      {children}
    </span>
  )
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  tone = 'indigo',
  type = 'button',
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  tone?: 'indigo' | 'emerald'
  type?: 'button' | 'submit'
}) {
  const colors =
    tone === 'emerald'
      ? 'bg-emerald-600 hover:bg-emerald-700'
      : 'bg-indigo-600 hover:bg-indigo-700'
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition-colors ${colors} disabled:cursor-not-allowed disabled:bg-slate-300`}
    >
      {children}
    </button>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <strong>Unable to complete this action.</strong> {message}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="font-semibold text-slate-700">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  )
}

export function PageLoading({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm font-medium text-slate-500">
      {children}
    </div>
  )
}
