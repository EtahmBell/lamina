interface AvatarProps {
  color: string
  emoji?: string
  initials?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-lg',
  lg: 'h-14 w-14 text-2xl',
}

export function Avatar({ color, emoji, initials, size = 'md' }: AvatarProps) {
  return (
    <div
      className={`${sizes[size]} ${color} flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none`}
    >
      {emoji ?? initials}
    </div>
  )
}
