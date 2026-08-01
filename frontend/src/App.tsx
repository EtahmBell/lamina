import { useEffect, useState } from 'react'
import {
  getAgent,
  getOrganizationMembers,
  getOrganizations,
  type AgentDetails,
  type OrganizationMember,
  type OrganizationSummary,
} from './api/client'
import { NetworkPage } from './components/NetworkPage'
import { PatientsPage } from './components/PatientsPage'
import { ProfilePage } from './components/ProfilePage'
import { ReviewInboxPage } from './components/ReviewInboxPage'
import { SignInPage } from './components/SignInPage'
import { Sidebar, type NavKey } from './components/Sidebar'
import { RightRail } from './components/RightRail'
import { ErrorBanner, PageLoading } from './components/ui'
import { useDemoSession } from './DemoSessionContext'
import { DEMO_IDENTITIES } from './session'
import { displayError } from './utils'

export default function App() {
  const { identity, signIn, signOut } = useDemoSession()
  const [nav, setNav] = useState<NavKey>('patients')
  const [physician, setPhysician] = useState<AgentDetails | null>(null)
  const [signInProfiles, setSignInProfiles] = useState<AgentDetails[]>([])
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null)
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([])
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true)
      setError(null)
      setPhysician(null)
      setOrganization(null)
      setOrganizationMembers([])
      try {
        if (!identity) {
          setSignInProfiles(
            await Promise.all(DEMO_IDENTITIES.map((item) => getAgent(item.agentId))),
          )
          return
        }
        const [agent, organizations] = await Promise.all([
          getAgent(identity.agentId),
          getOrganizations(),
        ])
        setPhysician(agent)
        const membershipResults = await Promise.all(
          organizations.map(async (item) => ({
            organization: item,
            members: await getOrganizationMembers(item.id),
          })),
        )
        const membership = membershipResults.find(({ members }) =>
          members.some((member) => member.physician_npi === identity.npi),
        )
        setOrganization(membership?.organization ?? null)
        setOrganizationMembers(membership?.members ?? [])
      } catch (loadError) {
        setError(displayError(loadError))
      } finally {
        setLoading(false)
      }
    }
    void loadSession()
  }, [identity])

  const openNetworkPost = (postId: string) => {
    setFocusedPostId(postId)
    setNav('network')
  }

  const handleSignOut = () => {
    setNav('patients')
    setFocusedPostId(null)
    setPhysician(null)
    setOrganization(null)
    setOrganizationMembers([])
    signOut()
  }

  if (!identity) {
    return (
      <SignInPage
        profiles={signInProfiles}
        loading={loading}
        error={error}
        onContinue={(npi) => {
          setNav('patients')
          setFocusedPostId(null)
          signIn(npi)
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={nav}
        physician={physician}
        organizationName={organization?.name ?? null}
        onNavigate={setNav}
        onSignOut={handleSignOut}
      />
      <div className="workspace-shell">
      <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="page-shell">
            <PageLoading>Loading your Lamina session...</PageLoading>
          </div>
        )}
        {!loading && error && (
          <div className="page-shell max-w-3xl">
            <ErrorBanner message={error} />
            <p className="secondary-copy mt-3">
              Lamina does not fall back to mocked physician or patient data when the backend is unavailable.
            </p>
          </div>
        )}
        {!loading && physician && !error && nav === 'patients' && (
          <PatientsPage
            physician={physician}
            organizationName={organization?.name ?? null}
            onOpenNetwork={openNetworkPost}
          />
        )}
        {!loading && physician && !error && nav === 'network' && (
          <NetworkPage
            focusedPostId={focusedPostId}
            physician={physician}
          />
        )}
        {!loading && physician && !error && nav === 'reviews' && (
          <ReviewInboxPage
            focusedPostId={focusedPostId}
            physician={physician}
            onApproved={openNetworkPost}
          />
        )}
        {!loading && physician && !error && nav === 'profile' && (
          <ProfilePage physician={physician} organization={organization} />
        )}
      </main>
      {!loading && physician && !error && (
        <RightRail
          active={nav}
          physician={physician}
          organization={organization}
          members={organizationMembers}
        />
      )}
      </div>
    </div>
  )
}
