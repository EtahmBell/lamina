export function AgentIdentityName({
  physicianName,
  className = '',
}: {
  physicianName: string
  className?: string
}) {
  const name = physicianName.split(',')[0].replace(/^Dr\.?\s+/i, '').trim()

  return (
    <span className={`agent-identity-name ${className}`.trim()}>
      Dr. {name}'s <strong className="agent-role-emphasis">Agent</strong>
    </span>
  )
}
