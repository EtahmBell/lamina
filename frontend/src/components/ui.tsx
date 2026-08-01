export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'clinical' | 'success' | 'warning' | 'danger'
}) {
  return (
    <span className="status-label" data-tone={tone}>
      {children}
    </span>
  )
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  tone = 'accent',
  type = 'button',
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
  tone?: 'accent' | 'approve'
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={tone === 'approve' ? 'button-approve' : 'button-primary'}
    >
      {children}
    </button>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="surface border-l-4 border-l-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">
      <strong>Unable to complete this action.</strong> {message}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="surface px-6 py-10 text-center">
      <div className="font-serif text-lg font-bold text-[var(--text-primary)]">{title}</div>
      <p className="secondary-copy mt-1">{detail}</p>
    </div>
  )
}

export function PageLoading({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface px-6 py-10 text-center text-sm font-medium text-[var(--text-secondary)]" role="status">
      {children}
    </div>
  )
}
