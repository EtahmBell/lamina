import ethanBellPortrait from '../assets/ethan-bell.png'
import lianneChaPortrait from '../assets/lianne-cha.png'

const DEMO_PORTRAITS: Record<string, string> = {
  '9000000999': ethanBellPortrait,
  '9000001000': lianneChaPortrait,
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
}: {
  npi: string
  name: string
  size?: 'small' | 'medium' | 'large' | 'hero'
}) {
  const portrait = DEMO_PORTRAITS[npi]

  return (
    <span className="physician-avatar" data-size={size} aria-hidden="true">
      {portrait ? (
        <img src={portrait} alt="" />
      ) : (
        <span>{initials(name) || 'MD'}</span>
      )}
    </span>
  )
}
