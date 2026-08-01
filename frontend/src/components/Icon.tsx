/**
 * Inline SVG icon set. Replaces the emoji glyphs the UI used to render, so icon
 * weight, size and colour stay consistent across platforms and follow currentColor.
 *
 * Every path is drawn on a 24x24 grid with a 1.7 stroke and round caps/joins,
 * except the few marked `solid` below which are filled shapes.
 */

const SOLID = new Set(['heart-filled', 'sparkle', 'dot'])

const paths: Record<string, React.ReactNode> = {
  // ---- navigation ----
  home: <path d="M3 10.2 12 3l9 7.2V20a1.5 1.5 0 0 1-1.5 1.5h-4V14h-7v7.5h-4A1.5 1.5 0 0 1 3 20z" />,
  library: (
    <>
      <path d="M4 4h4v16H4zM10 4h4v16h-4z" />
      <path d="m16.4 5.1 3.7 1 -3.6 13.4 -3.7-1z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.6 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a4.6 4.6 0 0 0 7 .6l2.7-2.7a4.6 4.6 0 0 0-6.6-6.6L11.6 5.9" />
      <path d="M14 11a4.6 4.6 0 0 0-7-.6L4.3 13.1a4.6 4.6 0 0 0 6.6 6.6l1.5-1.6" />
    </>
  ),
  message: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />,
  workflow: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4.5M9.5 4.5h5" />
      <circle cx="9" cy="14" r="1.2" />
      <circle cx="15" cy="14" r="1.2" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5" />
      <path d="m16 16 4-4-4-4M20 12H9.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),

  // ---- actions ----
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  close: <path d="M6 6 18 18M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (
    <>
      <path d="M4 20.5 4.8 16 16.4 4.4a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8 19.2z" />
      <path d="m15 6 3 3" />
    </>
  ),
  share: <path d="M4 14 20 4l-6.5 16-2.3-6.7L4 14z" />,
  heart: <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />,
  'heart-filled': <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />,
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  book: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21.5z" />
      <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
    </>
  ),
  note: (
    <>
      <path d="M19 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
      <path d="M16.5 3.5a1.9 1.9 0 0 1 2.7 2.7L12.8 12.6l-3.4.7.7-3.4z" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3A2.5 2.5 0 1 1 12 12.6V14" />
      <path d="M12 17.4v.01" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M9.2 17a6 6 0 1 1 5.6 0" />
      <path d="M9.5 20h5M10 22h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  quote: (
    <>
      <path d="M9.5 6.5C6.4 7.6 4.5 10.2 4.5 13.6v3.9h6v-6H7.4c.2-1.6 1.1-2.8 2.6-3.4z" />
      <path d="M18.5 6.5c-3.1 1.1-5 3.7-5 7.1v3.9h6v-6h-3.1c.2-1.6 1.1-2.8 2.6-3.4z" />
    </>
  ),
  reply: <path d="M9 7 4 12l5 5M4 12h9a7 7 0 0 1 7 7v1" />,
  construction: (
    <>
      <path d="M14.7 6.3a3.6 3.6 0 0 0 4.8 4.8l-8.4 8.4a2.4 2.4 0 1 1-3.4-3.4z" />
      <path d="M5.2 4.2 8 7l-1.4 1.4L3.8 5.6a1 1 0 0 1 0-1.4 1 1 0 0 1 1.4 0z" />
    </>
  ),
  celebrate: (
    <>
      <path d="m3 21 4.5-12L16 17.5z" />
      <path d="M14 3.5v2M18.5 5.5 17 7M20.5 10h-2M17.5 13.5 16 12" />
    </>
  ),
  sparkle: <path d="m12 2.5 2.3 6.4 6.4 2.3-6.4 2.3L12 20l-2.3-6.5L3.3 11.2l6.4-2.3z" />,
  dot: <circle cx="12" cy="12" r="4" />,

  // ---- arrows ----
  'arrow-right': <path d="M4 12h15m-6-6 6 6-6 6" />,
  'arrow-left': <path d="M20 12H5m6 6-6-6 6-6" />,
  'arrow-up': <path d="M12 20V5m-6 6 6-6 6 6" />,

  // ---- agent specialties ----
  cardiology: (
    <>
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
      <path d="m6.5 12.4h2.8l1.3-2.4 1.8 4.4 1.4-2h3" />
    </>
  ),
  neurology: (
    <>
      <path d="M12 4.2a3.2 3.2 0 0 0-3.1 2.4A3 3 0 0 0 6 9.4a3 3 0 0 0 .5 1.7A3.1 3.1 0 0 0 6 13a3 3 0 0 0 2.4 2.9A3 3 0 0 0 12 19.8z" />
      <path d="M12 4.2a3.2 3.2 0 0 1 3.1 2.4A3 3 0 0 1 18 9.4a3 3 0 0 1-.5 1.7A3.1 3.1 0 0 1 18 13a3 3 0 0 1-2.4 2.9A3 3 0 0 1 12 19.8z" />
      <path d="M12 4.2v15.6" />
    </>
  ),
  radiology: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M12 6.5v11M8 8.5v7M16 8.5v7M6.5 12h11" />
    </>
  ),
  pediatrics: (
    <>
      <circle cx="12" cy="9" r="4.2" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
      <path d="M10.4 8.4v.01M13.6 8.4v.01" />
    </>
  ),
  oncology: (
    <>
      <path d="M7 3c0 5 10 4 10 9s-10 4-10 9" />
      <path d="M17 3c0 5-10 4-10 9s10 4 10 9" />
      <path d="M8.4 7h7.2M8.4 17h7.2M7.6 12h8.8" />
    </>
  ),
  pharmacology: (
    <>
      <rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)" />
      <path d="m9.4 9.4 5.2 5.2" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3v5a4 4 0 0 0 8 0V3" />
      <path d="M6 3H4.5M14 3h1.5" />
      <path d="M10 12v2.5a4.5 4.5 0 0 0 9 0V13" />
      <circle cx="19" cy="11" r="2" />
    </>
  ),
}

export type IconName = keyof typeof paths

export function Icon({
  name,
  className = 'h-5 w-5',
  strokeWidth = 1.7,
}: {
  name: IconName
  className?: string
  strokeWidth?: number
}) {
  const solid = SOLID.has(name as string)
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={solid ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}

/** Maps an agent's specialty to its avatar glyph. */
const specialtyIcons: Record<string, IconName> = {
  Cardiology: 'cardiology',
  Neurology: 'neurology',
  Radiology: 'radiology',
  Pediatrics: 'pediatrics',
  Oncology: 'oncology',
  Pharmacology: 'pharmacology',
}

export function specialtyIcon(specialty: string | undefined): IconName {
  return (specialty && specialtyIcons[specialty]) || 'sparkle'
}
