import type { AgentDetails } from '../api/client'
import { AskLaminaComposer } from './AskLaminaComposer'
import { Badge } from './ui'

export type AskLaminaConfiguration = {
  contextLabel: string
  placeholder: string
  processingLabel: string
  suggestions?: string[]
  onSubmit: (request: string) => Promise<string>
}

export function RightRail({
  physician,
  configuration,
}: {
  physician: AgentDetails
  configuration: AskLaminaConfiguration
}) {
  return (
    <aside className="right-rail ask-right-rail" aria-label="Ask Lamina">
      <section className="rail-card ask-panel-card">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Ask Lamina</div>
          <Badge tone="clinical">Network tools</Badge>
        </div>
        <h2 className="publication-title mt-3">How can Lamina help?</h2>
        <p className="secondary-copy mt-2">
          Work with your physician network or the current bounded patient context.
        </p>
        <div className="ask-panel-context mt-4">
          <span>Current context</span>
          <strong>{configuration.contextLabel}</strong>
        </div>
        <AskLaminaComposer
          contextLabel={physician.physician.display_name}
          placeholder={configuration.placeholder}
          processingLabel={configuration.processingLabel}
          suggestions={configuration.suggestions}
          onSubmit={configuration.onSubmit}
          panel
        />
      </section>
      <p className="ask-panel-safety">
        Lamina routes supported actions through existing physician-network workflows. It does not provide generic medical chat.
      </p>
    </aside>
  )
}
