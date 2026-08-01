import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  getPhysicianProfile,
  searchPhysicians,
  type PhysicianDirectoryResult,
} from '../api/client'
import {
  normalizeShowcaseSearch,
  SHOWCASE_PHYSICIANS,
  type ShowcasePhysician,
} from '../demo/showcaseFeed'
import { displayError } from '../utils'
import { PhysicianAvatar } from './PhysicianAvatar'
import { ShowcasePhysicianCard, ShowcasePhysicianProfile } from './ShowcasePhysician'
import type { AskLaminaConfiguration } from './RightRail'
import { Badge, ErrorBanner } from './ui'

export function PhysiciansPage({
  connectedIds,
  onToggleConnection,
  onAskChange,
}: {
  connectedIds: string[]
  onToggleConnection: (physicianId: string) => void
  onAskChange: (configuration: AskLaminaConfiguration) => void
}) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
  const [results, setResults] = useState<PhysicianDirectoryResult[]>([])
  const [selectedDirectory, setSelectedDirectory] = useState<PhysicianDirectoryResult | null>(null)
  const [selectedShowcase, setSelectedShowcase] = useState<ShowcasePhysician | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const askPhysicians = useCallback(async (request: string) => {
    const terms = normalizeShowcaseSearch(request)
      .replace(/\b(find|who|is|a|an|near|my|practice)\b/g, ' ').trim()
    setQuery(terms)
    const matches = SHOWCASE_PHYSICIANS.filter((item) =>
      `${item.name} ${item.specialty} ${item.location} ${item.topics.join(' ')}`.toLowerCase().includes(terms),
    )
    return matches.length
      ? `Found ${matches.length} fictional showcase agent${matches.length === 1 ? '' : 's'}. Use NPPES search separately for physician directory records.`
      : 'No fictional showcase agents matched. Submit an NPPES directory search for broader physician records.'
  }, [])

  useEffect(() => {
    if (selectedDirectory) {
      const synthetic = selectedDirectory.source.toLowerCase() === 'synthetic'
      onAskChange({
        contextLabel: `${selectedDirectory.display_name} · ${synthetic ? 'synthetic Lamina profile' : 'unclaimed NPPES profile'}`,
        placeholder: 'Ask about this directory profile...',
        processingLabel: 'Reviewing directory profile context...',
        suggestions: ['What does unclaimed mean?', 'Can this profile access patient data?'],
        onSubmit: async () => synthetic
          ? 'This synthetic Lamina profile is separate from fictional showcase connections.'
          : 'This is unclaimed NPPES directory data. Lamina does not attribute activity, authorization, or endorsement to it.',
      })
      return
    }
    if (selectedShowcase) {
      onAskChange({
        contextLabel: `Dr. ${selectedShowcase.name}'s Agent · synthetic profile`,
        placeholder: 'Ask about this showcase agent...',
        processingLabel: 'Reviewing synthetic agent context...',
        suggestions: ['What topics does this agent discuss?', 'Is this a real Lamina agent?'],
        onSubmit: async () =>
          `Dr. ${selectedShowcase.name}'s Agent is completely fictional. The displayed agent profile, activity, and proximity are isolated hackathon showcase data.`,
      })
      return
    }
    onAskChange({
      contextLabel: 'Physicians · discovery and NPPES directory',
      placeholder: 'Find a specialist by topic or location...',
      processingLabel: 'Searching fictional showcase profiles...',
      suggestions: ['Find a cardiologist near my practice', 'Who works on diabetes?'],
      onSubmit: askPhysicians,
    })
  }, [askPhysicians, onAskChange, selectedDirectory, selectedShowcase])

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    setError(null)
    setSelectedDirectory(null)
    try {
      setResults(await searchPhysicians(query.trim(), state || undefined))
    } catch (searchError) {
      setResults([])
      setError(displayError(searchError))
    } finally {
      setSearching(false)
    }
  }

  const openDirectoryProfile = async (npi: string) => {
    setSearching(true)
    setError(null)
    try {
      setSelectedDirectory(await getPhysicianProfile(npi))
    } catch (loadError) {
      setError(displayError(loadError))
    } finally {
      setSearching(false)
    }
  }

  if (selectedShowcase) {
    return (
      <div className="page-shell">
        <ShowcasePhysicianProfile
          physician={selectedShowcase}
          connected={connectedIds.includes(selectedShowcase.id)}
          onToggleConnection={onToggleConnection}
          onBack={() => setSelectedShowcase(null)}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <header className="page-hero">
        <div>
          <div className="eyebrow">Physician discovery</div>
          <h1 className="page-title mt-1">Physicians</h1>
          <p className="secondary-copy mt-2">
            Discover fictional demo colleagues or search the live NPPES directory.
          </p>
        </div>
      </header>

      {error && <div className="mt-5"><ErrorBanner message={error} /></div>}

      <section className="mt-7">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title">Agents to know</h2>
          <Badge tone="success">Synthetic showcase agents</Badge>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {SHOWCASE_PHYSICIANS.map((physician) => (
            <ShowcasePhysicianCard
              key={physician.id}
              physician={physician}
              connected={connectedIds.includes(physician.id)}
              onToggleConnection={onToggleConnection}
              onOpen={(item) => {
                setSelectedDirectory(null)
                setSelectedShowcase(item)
              }}
            />
          ))}
        </div>
      </section>

      <section className="section-rule mt-10 pt-8">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title">NPPES Directory</h2>
          <Badge tone="clinical">Directory data</Badge>
        </div>
        <p className="secondary-copy mt-2">
          NPPES records do not imply that a physician joined or authorized Lamina.
        </p>
        <form onSubmit={(event) => void runSearch(event)} className="mt-4 flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search physician name or specialty"
            className="input-control min-w-64 flex-1"
          />
          <input
            value={state}
            onChange={(event) => setState(event.target.value.toUpperCase().slice(0, 2))}
            placeholder="State"
            aria-label="State abbreviation"
            className="input-control w-24 uppercase"
          />
          <button
            type="submit"
            disabled={searching || query.trim().length < 2 || (state.length > 0 && state.length !== 2)}
            className="button-primary"
          >
            {searching ? 'Searching...' : 'Search NPPES'}
          </button>
        </form>

        {selectedDirectory && (
          <DirectoryProfile physician={selectedDirectory} />
        )}

        <div className="surface mt-5 divide-y divide-[var(--border)]">
          {results.map((physician) => (
            <button
              key={physician.npi}
              type="button"
              onClick={() => void openDirectoryProfile(physician.npi)}
              className="flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-[#f8f2e9]"
            >
              <PhysicianAvatar npi={physician.npi} name={physician.display_name} size="small" />
              <span className="min-w-0 flex-1">
                <span className="physician-name block text-lg font-bold">{physician.display_name}</span>
                <span className="secondary-copy block">
                  {physician.primary_specialty || 'Specialty not listed'}
                  {physician.city ? ` · ${physician.city}, ${physician.state}` : ''}
                </span>
              </span>
              <Badge tone={physician.source.toLowerCase() === 'synthetic' ? 'success' : 'clinical'}>
                {physician.source.toLowerCase() === 'synthetic' ? 'Synthetic' : 'NPPES · unclaimed'}
              </Badge>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function DirectoryProfile({ physician }: { physician: PhysicianDirectoryResult }) {
  const synthetic = physician.source.toLowerCase() === 'synthetic'
  return (
    <article className="surface mt-5 border-l-4 border-l-[var(--clinical)] px-5 py-5">
      <div className="flex items-start gap-4">
        <PhysicianAvatar npi={physician.npi} name={physician.display_name} size="large" />
        <div>
          <Badge tone={synthetic ? 'success' : 'clinical'}>
            {synthetic ? 'Synthetic Lamina physician' : 'NPPES Directory Profile'}
          </Badge>
          {!synthetic && <Badge tone="warning">Unclaimed</Badge>}
          <h3 className="physician-name mt-4 text-2xl font-bold">{physician.display_name}</h3>
          <p className="secondary-copy mt-1">
            {physician.primary_specialty || 'Specialty not listed'}
            {physician.city ? ` · ${physician.city}, ${physician.state}` : ''}
          </p>
          <p className="metadata mt-3">NPI {physician.npi}</p>
          {!synthetic && (
            <p className="secondary-copy mt-4 border-t border-[var(--border)] pt-4">
              No Lamina activity, connections, or endorsement is attributed to this directory record.
            </p>
          )}
        </div>
      </div>
    </article>
  )
}
