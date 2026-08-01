import laminaLogo from '../assets/lamina-logo-source.png'

export function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className={`flex items-center ${large ? 'gap-3' : 'gap-2.5'}`}>
      <span className={`brand-symbol ${large ? 'brand-symbol-large' : ''}`} aria-hidden="true">
        <img src={laminaLogo} alt="" />
      </span>
      <div className={`wordmark font-bold tracking-[0.08em] ${large ? 'text-[2rem]' : 'text-[1.55rem]'}`}>
        LAMINA
      </div>
    </div>
  )
}
