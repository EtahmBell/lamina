import { useState, type FormEvent } from 'react'
import { searchPhysicians, type PhysicianDirectoryResult } from '../api/client'
import { displayError } from '../utils'
import { Icon } from './Icon'
import { Badge, ErrorBanner } from './ui'

/**
 * Demo claim flow: find a real physician in the NPPES directory, "verify" a
 * hospital email, and mark the reserved agent as claimed. Verification is
 * mocked for the hackathon — no email is actually sent and the accepted code
 * is fixed. Claiming has no backend effect.
 */

const MOCK_VERIFICATION_CODE = '124124'
const CLAIMED_STORAGE_KEY = 'lamina.claimedAgents'

type ClaimStep = 'search' | 'email' | 'code' | 'claimed'

function claimedAgents(): string[] {
  try {
    const raw = window.localStorage.getItem(CLAIMED_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function markClaimed(npi: string): void {
  const current = claimedAgents()
  if (!current.includes(npi)) {
    window.localStorage.setItem(CLAIMED_STORAGE_KEY, JSON.stringify([...current, npi]))
  }
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function physicianDisplayName(physician: PhysicianDirectoryResult): string {
  return titleCase(physician.display_name.split(',')[0].trim())
}

export function ClaimAgentFlow({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<ClaimStep>('search')
  const [query, setQuery] = useState('')
  const [state, setState] = useState('')
  const [results, setResults] = useState<PhysicianDirectoryResult[]>([])
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<PhysicianDirectoryResult | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<string[]>(claimedAgents)

  const search = async (event: FormEvent) => {
    event.preventDefault()
    const clean = query.trim()
    if (!clean || busy) return
    setBusy(true)
    setError(null)
    try {
      setResults(await searchPhysicians(clean, state.trim().toUpperCase() || undefined))
      setSearched(true)
    } catch (searchError) {
      setError(displayError(searchError))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = (event: FormEvent) => {
    event.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid hospital email address.')
      return
    }
    setError(null)
    setBusy(true)
    // Mock send — no email leaves the demo environment.
    window.setTimeout(() => {
      setBusy(false)
      setCodeSent(true)
      setStep('code')
    }, 700)
  }

  const verifyCode = (event: FormEvent) => {
    event.preventDefault()
    if (code.trim() !== MOCK_VERIFICATION_CODE) {
      setError('Incorrect verification code. Check the email we sent and try again.')
      return
    }
    if (selected) {
      markClaimed(selected.npi)
      setClaimed(claimedAgents())
    }
    setError(null)
    setStep('claimed')
  }

  const selectedName = selected ? physicianDisplayName(selected) : ''

  return (
    <section className="claim-flow">
      <button
        type="button"
        onClick={() => {
          if (step === 'search') onBack()
          else if (step === 'email') { setStep('search'); setError(null) }
          else if (step === 'code') { setStep('email'); setError(null) }
          else onBack()
        }}
        className="text-action inline-flex items-center gap-1.5"
      >
        <Icon name="arrow-left" className="h-4 w-4" />
        {step === 'search' || step === 'claimed' ? 'Back to sign in' : 'Back'}
      </button>

      {step === 'search' && (
        <>
          <div className="eyebrow mt-6">Claim your agent</div>
          <h1 className="section-title mt-2">Find yourself in the physician directory.</h1>
          <p className="secondary-copy mt-2 max-w-xl">
            Every physician in the national directory has a reserved, inactive agent. Search your
            name, then verify a hospital email to claim yours.
          </p>

          <form onSubmit={(event) => void search(event)} className="claim-search-row mt-5">
            <div className="feed-searchbar flex-1">
              <Icon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your name — e.g. Rebecca Smith"
                aria-label="Search physician name"
              />
            </div>
            <input
              value={state}
              onChange={(event) => setState(event.target.value)}
              placeholder="State"
              aria-label="State abbreviation"
              maxLength={2}
              className="claim-state-input"
            />
            <button type="submit" disabled={!query.trim() || busy} className="button-primary">
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>

          {error && <div className="mt-4"><ErrorBanner message={error} /></div>}

          <div className="mt-5 grid gap-3">
            {results.map((physician) => {
              const isClaimed = claimed.includes(physician.npi)
              return (
                <article key={physician.npi} className="claim-result">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="physician-name text-lg font-bold">
                        {physicianDisplayName(physician)}
                      </span>
                    </div>
                    <div className="metadata mt-1">
                      {physician.primary_specialty} · {titleCase(physician.city)}, {physician.state}
                      {' '}· NPI {physician.npi}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="clinical">Directory profile found</Badge>
                      {isClaimed
                        ? <Badge tone="success">Agent claimed</Badge>
                        : <Badge tone="warning">Agent reserved · unclaimed</Badge>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isClaimed}
                    onClick={() => {
                      setSelected(physician)
                      setError(null)
                      setStep('email')
                    }}
                    className="button-primary shrink-0"
                  >
                    {isClaimed ? 'Claimed' : 'This is me'}
                  </button>
                </article>
              )
            })}
            {searched && results.length === 0 && !error && (
              <p className="secondary-copy">
                No physicians match that search. Try a different spelling or add a state.
              </p>
            )}
          </div>
        </>
      )}

      {step === 'email' && selected && (
        <>
          <div className="eyebrow mt-6">Step 2 of 3</div>
          <h1 className="section-title mt-2">Verify a hospital email for {selectedName}.</h1>
          <p className="secondary-copy mt-2 max-w-xl">
            We send a one-time code to your institutional email to confirm you are this physician.
            For this synthetic demo no real email is sent.
          </p>

          <div className="claim-selected mt-5">
            <div className="min-w-0">
              <div className="physician-name font-bold">{selectedName}</div>
              <div className="metadata mt-0.5">
                {selected.primary_specialty} · {titleCase(selected.city)}, {selected.state}
              </div>
            </div>
            <Badge tone="warning">Unclaimed</Badge>
          </div>

          <form onSubmit={sendCode} className="mt-5 flex max-w-xl flex-wrap gap-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@hospital.org"
              aria-label="Hospital email"
              className="input-control min-w-0 flex-1"
              autoFocus
            />
            <button type="submit" disabled={busy} className="button-primary">
              {busy ? 'Sending code…' : 'Send verification code'}
            </button>
          </form>
          {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
        </>
      )}

      {step === 'code' && selected && (
        <>
          <div className="eyebrow mt-6">Step 3 of 3</div>
          <h1 className="section-title mt-2">Enter the verification code.</h1>
          <p className="secondary-copy mt-2 max-w-xl">
            {codeSent && (
              <>A 6-digit code was sent to <strong>{email.trim()}</strong>. </>
            )}
            Demo environment: the code is <strong>124124</strong>.
          </p>

          <form onSubmit={verifyCode} className="mt-5 flex max-w-md flex-wrap gap-3">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              aria-label="Verification code"
              className="input-control claim-code-input"
              autoFocus
            />
            <button
              type="submit"
              disabled={code.length !== 6}
              className="button-primary"
            >
              Verify and claim agent
            </button>
          </form>
          {error && <div className="mt-4"><ErrorBanner message={error} /></div>}
        </>
      )}

      {step === 'claimed' && selected && (
        <div className="claim-success mt-8">
          <span className="claim-success-icon">
            <Icon name="check" className="h-7 w-7" />
          </span>
          <h1 className="section-title mt-4">Dr. {selectedName.split(' ').slice(-1)[0]}&apos;s agent is claimed.</h1>
          <p className="secondary-copy mx-auto mt-2 max-w-md">
            {selectedName} · {selected.primary_specialty} · NPI {selected.npi}. The reserved agent
            for this profile is now marked claimed in this demo. Active workspace sessions remain
            limited to the synthetic demo physicians.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Badge tone="success">Agent claimed</Badge>
            <Badge tone="clinical">Verification complete</Badge>
          </div>
          <button type="button" onClick={onBack} className="button-primary mx-auto mt-6">
            Continue to sign in
          </button>
        </div>
      )}
    </section>
  )
}
