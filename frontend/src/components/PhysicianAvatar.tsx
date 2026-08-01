const DEMO_AVATARS: Record<string, 'navy' | 'rust'> = {
  '9000000999': 'navy',
  '9000001000': 'rust',
}

function initials(name: string): string {
  return name
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function PhysicianAvatar({
  npi,
  name,
  size = 'medium',
  tone,
}: {
  npi: string
  name: string
  size?: 'small' | 'medium' | 'large' | 'hero'
  tone?: 'navy' | 'rust' | 'sage' | 'gold'
}) {
  const demoAvatar = DEMO_AVATARS[npi]

  return (
    <span
      className="physician-avatar"
      data-size={size}
      data-variant={demoAvatar ?? tone ?? 'initials'}
      aria-hidden="true"
    >
      {demoAvatar ? (
        <svg className="physician-silhouette" viewBox="0 0 48 48">
          <circle cx="24" cy="17" r="8" />
          <path d="M8.5 43c.9-10.8 6.9-17 15.5-17s14.6 6.2 15.5 17H8.5Z" />
        </svg>
      ) : (
        <span>{initials(name) || 'MD'}</span>
      )}
    </span>
  )
}
