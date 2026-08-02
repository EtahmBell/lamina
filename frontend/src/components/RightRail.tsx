import { useEffect, useRef, useState } from 'react'
import type { AgentDetails, ReferralRecommendations } from '../api/client'
import { displayError } from '../utils'
import { AskLaminaComposer } from './AskLaminaComposer'
import { Icon } from './Icon'

export type AskLaminaConfiguration = {
  contextLabel: string
  placeholder: string
  processingLabel: string
  suggestions?: string[]
  onSubmit: (request: string) => Promise<AskLaminaReply>
}

export type AskLaminaReply = string | ReferralRecommendations

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  text?: string
  referral?: ReferralRecommendations
  error?: boolean
}

let messageId = 0

function timeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function RightRail({
  physician,
  configuration,
  onViewPhysician,
}: {
  physician: AgentDetails
  configuration: AskLaminaConfiguration
  onViewPhysician: (npi: string) => void
}) {
  const baseName = physician.physician.display_name.split(',')[0].replace(/^Dr\.?\s+/i, '').trim()
  const lastName = baseName.split(' ').slice(-1)[0]

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [processing, setProcessing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fresh conversation when the signed-in physician changes.
  useEffect(() => {
    setMessages([])
    setProcessing(false)
  }, [physician.physician_npi])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, processing])

  const send = async (text: string) => {
    const clean = text.trim()
    if (!clean || processing) return
    setMessages((prev) => [...prev, { id: ++messageId, role: 'user', text: clean }])
    setProcessing(true)
    try {
      const reply = await configuration.onSubmit(clean)
      setMessages((prev) => [
        ...prev,
        {
          id: ++messageId,
          role: 'assistant',
          ...(typeof reply === 'string' ? { text: reply } : { referral: reply }),
        },
      ])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: ++messageId, role: 'assistant', text: displayError(error), error: true },
      ])
    } finally {
      setProcessing(false)
    }
  }

  return (
    <aside className="right-rail ask-right-rail agent-chat" aria-label="Your agent">
      <header className="agent-chat-header">
        <div className="agent-chat-avatar">
          <Icon name="sparkle" className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="agent-chat-name truncate">Dr. {baseName} Agent</div>
          <div className="agent-chat-status">
            <span className="agent-chat-status-dot" aria-hidden="true" />
            Online
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="agent-chat-messages">
        <div className="agent-chat-bubble assistant">
          {timeGreeting()}, Dr. {lastName}. I&apos;m your Lamina agent. I can search the physician
          network, find specialists, or work with your current context. What would you like to do?
        </div>
        <div className="agent-chat-context">Context · {configuration.contextLabel}</div>
        {messages.map((message) => (
          <div
            key={message.id}
            className={`agent-chat-bubble ${message.role}${message.error ? ' error' : ''}`}
          >
            {message.referral ? (
              <div className="space-y-4">
                <div>
                  <div className="eyebrow">Relevant referral candidates</div>
                  <div className="physician-name mt-1 text-xl font-semibold">
                    {message.referral.specialty}
                  </div>
                  <p className="secondary-copy mt-1 text-sm">{message.referral.reason}</p>
                </div>
                {message.referral.candidates.length ? (
                  message.referral.candidates.map((candidate) => {
                    const unclaimed = candidate.lamina_status === 'unclaimed'
                    const statusLabel = unclaimed
                      ? 'NPPES Directory · Unclaimed'
                      : candidate.connection_status === 'connected'
                        ? 'Connected'
                        : candidate.lamina_status === 'active'
                          ? 'Active on Lamina'
                          : 'Lamina profile'
                    return (
                      <article
                        key={candidate.npi}
                        className="border-t border-[var(--border)] pt-3"
                      >
                        <div className="physician-name text-lg font-semibold">
                          {candidate.name}
                        </div>
                        <div className="metadata mt-1">
                          {candidate.specialty} · {statusLabel}
                        </div>
                        {(candidate.city || candidate.state) && (
                          <div className="secondary-copy mt-1 text-sm">
                            {[candidate.city, candidate.state].filter(Boolean).join(', ')}
                          </div>
                        )}
                        <div className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                          Why {candidate.name.split(',')[0]} surfaced
                        </div>
                        <ul className="secondary-copy mt-1 list-disc space-y-0.5 pl-5 text-sm">
                          {candidate.why.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                        <button
                          type="button"
                          onClick={() => onViewPhysician(candidate.npi)}
                          className="text-action mt-3"
                        >
                          View profile
                        </button>
                      </article>
                    )
                  })
                ) : (
                  <p className="secondary-copy text-sm">
                    No matching directory candidates were found.
                  </p>
                )}
              </div>
            ) : message.text}
          </div>
        ))}
        {processing && (
          <div className="agent-chat-bubble assistant processing" role="status">
            {configuration.processingLabel}
          </div>
        )}
      </div>

      <footer className="agent-chat-footer">
        <AskLaminaComposer
          key={physician.physician_npi}
          contextLabel={configuration.contextLabel}
          placeholder={configuration.placeholder}
          processingLabel={configuration.processingLabel}
          suggestions={configuration.suggestions}
          panel
          onSubmit={async (request) => {
            await send(request)
            return ''
          }}
        />
        <p className="agent-chat-safety">
          Lamina routes supported actions through physician-network workflows. It does not provide
          generic medical chat.
        </p>
      </footer>
    </aside>
  )
}
