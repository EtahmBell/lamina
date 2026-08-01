import { useState } from 'react'
import type { AgentDetails } from '../api/client'
import { Brand } from './Brand'
import { ClaimAgentFlow } from './ClaimAgentFlow'
import { Icon } from './Icon'
import { PhysicianAvatar } from './PhysicianAvatar'
import { Badge, ErrorBanner, PageLoading } from './ui'

export function SignInPage({
  profiles,
  loading,
  error,
  onContinue,
}: {
  profiles: AgentDetails[]
  loading: boolean
  error: string | null
  onContinue: (npi: string) => void
}) {
  const [claiming, setClaiming] = useState(false)

  if (claiming) {
    return (
      <main className="demo-sign-in">
        <section className="demo-sign-in-panel">
          <Brand large />
          <ClaimAgentFlow onBack={() => setClaiming(false)} />
        </section>
      </main>
    )
  }

  return (
    <main className="demo-sign-in">
      <section className="demo-sign-in-panel">
        <Brand large />
        <p className="publication-title mt-4 text-[1.35rem] font-normal">
          From clinical question to trusted referral.
        </p>

        <div className="section-rule mt-8 pt-7">
          <div className="eyebrow">Demo physician access</div>
          <h1 className="section-title mt-2">Select a synthetic physician profile.</h1>
          <p className="secondary-copy mt-2 max-w-xl">
            This controlled hackathon selector is not production authentication.
          </p>
        </div>

        {error && <div className="mt-5"><ErrorBanner message={error} /></div>}
        {loading ? (
          <div className="mt-6"><PageLoading>Loading authorized demo profiles...</PageLoading></div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {profiles.map((profile) => (
              <button
                key={profile.physician_npi}
                type="button"
                onClick={() => onContinue(profile.physician_npi)}
                className="surface demo-profile-choice text-left"
              >
                <div className="flex items-center gap-4">
                  <PhysicianAvatar
                    npi={profile.physician_npi}
                    name={profile.physician.display_name}
                    size="large"
                  />
                  <div>
                    <div className="physician-name text-xl font-bold">
                      {profile.physician.display_name}
                    </div>
                    <div className="secondary-copy mt-1">{profile.physician.primary_specialty}</div>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <Badge tone="success">Synthetic</Badge>
                  <span className="text-action">Continue</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="section-rule mt-7 pt-6">
          <button
            type="button"
            onClick={() => setClaiming(true)}
            className="claim-entry-button"
          >
            <Icon name="sparkle" className="h-4 w-4" />
            Claim your physician agent
            <Icon name="arrow-right" className="ml-auto h-4 w-4 opacity-70" />
          </button>
          <p className="metadata mt-2">
            Are you a physician? Find your directory profile and activate your reserved agent.
          </p>
        </div>

        <p className="metadata mt-7">Synthetic hackathon environment</p>
      </section>
    </main>
  )
}
