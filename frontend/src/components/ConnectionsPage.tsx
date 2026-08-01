import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  normalizeShowcaseSearch,
  SHOWCASE_PHYSICIANS,
  type ShowcasePhysician,
} from '../demo/showcaseFeed'
import { ShowcasePhysicianCard, ShowcasePhysicianProfile } from './ShowcasePhysician'
import type { AskLaminaConfiguration } from './RightRail'
import { EmptyState } from './ui'

export function ConnectionsPage({
  connectedIds,
  onToggleConnection,
  onAskChange,
}: {
  connectedIds: string[]
  onToggleConnection: (physicianId: string) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ShowcasePhysician | null>(null)
  const connected = useMemo(() => {
    const query = search.trim().toLowerCase()
    return SHOWCASE_PHYSICIANS.filter(
      (physician) => connectedIds.includes(physician.id) &&
        (!query || `${physician.name} ${physician.specialty} ${physician.location}`.toLowerCase().includes(query)),
    )
  }, [connectedIds, search])

  const askConnections = useCallback(async (request: string) => {
    const terms = normalizeShowcaseSearch(request)
      .replace(/\b(find|who|in|my|network|works|on|near|practice)\b/g, ' ').trim()
    setSearch(terms)
    const matches = SHOWCASE_PHYSICIANS.filter(
      (item) => connectedIds.includes(item.id) &&
        (!terms || `${item.name} ${item.specialty} ${item.location} ${item.topics.join(' ')}`.toLowerCase().includes(terms)),
    )
    return matches.length
      ? `Found ${matches.length} matching agentic connection${matches.length === 1 ? '' : 's'}.`
      : 'No current demo connections matched. Use Physicians to discover fictional specialists.'
  }, [connectedIds])

  useEffect(() => {
    if (selected) {
      onAskChange({
        contextLabel: `Dr. ${selected.name}'s Agent · synthetic connection`,
        placeholder: 'Ask about this agentic connection...',
        processingLabel: 'Reviewing synthetic agent context...',
        suggestions: ['What topics do they represent?', 'Is this connection clinical authorization?'],
        onSubmit: async () =>
          `Dr. ${selected.name}'s Agent is a fictional showcase connection. Agentic connections never grant patient or Medplum access.`,
      })
      return
    }
    onAskChange({
      contextLabel: 'Agentic Connections · your demo network',
      placeholder: 'Find expertise in your connections...',
      processingLabel: 'Searching your demo connections...',
      suggestions: ['Who in my network works on diabetes?', 'Find a cardiologist in my network'],
      onSubmit: askConnections,
    })
  }, [askConnections, onAskChange, selected])

  if (selected) {
    return (
      <div className="page-shell">
        <ShowcasePhysicianProfile
          physician={selected}
          connected={connectedIds.includes(selected.id)}
          onToggleConnection={onToggleConnection}
          onBack={() => setSelected(null)}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <header className="page-hero">
        <div>
          <div className="eyebrow">Agent network</div>
          <h1 className="page-title mt-1">Agentic Connections</h1>
          <p className="secondary-copy mt-2">
            Demo connections between agents representing fictional showcase physicians. Clinical access remains unchanged.
          </p>
        </div>
        <div className="connection-count">{connectedIds.length}</div>
      </header>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search your network..."
        aria-label="Search your network"
        className="input-control mt-6"
      />

      {connected.length ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {connected.map((physician) => (
            <ShowcasePhysicianCard
              key={physician.id}
              physician={physician}
              connected
              onToggleConnection={onToggleConnection}
              onOpen={setSelected}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState
            title={connectedIds.length ? 'No connections match this search.' : 'No connections yet.'}
            detail="Discover fictional showcase agents through Home or the Physicians directory."
          />
        </div>
      )}
    </div>
  )
}
