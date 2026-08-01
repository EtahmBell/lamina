import { useCallback, useEffect, useState } from 'react'
import {
  getAgent,
  getOrganizationMembers,
  getOrganizations,
  type AgentDetails,
  type OrganizationSummary,
} from './api/client'
import { NetworkPage } from './components/NetworkPage'
import { AgentSetupPage } from './components/AgentSetupPage'
import { ConnectionsPage } from './components/ConnectionsPage'
import { PatientsPage } from './components/PatientsPage'
import { PhysiciansPage } from './components/PhysiciansPage'
import { ProfilePage } from './components/ProfilePage'
import {
  PostComposerModal,
  type PatientPostContext,
} from './components/PostComposerModal'
import { ReviewInboxPage } from './components/ReviewInboxPage'
import { SignInPage } from './components/SignInPage'
import { Sidebar, type NavKey } from './components/Sidebar'
import { RightRail, type AskLaminaConfiguration } from './components/RightRail'
import { ErrorBanner, PageLoading } from './components/ui'
import { useDemoSession } from './DemoSessionContext'
import { DEMO_IDENTITIES } from './session'
import { displayError } from './utils'
import { getDemoConnections, saveDemoConnections } from './demo/demoConnections'

const DEFAULT_ASK_CONFIGURATION: AskLaminaConfiguration = {
  contextLabel: 'Lamina physician workspace',
  placeholder: 'Ask about your network or current workflow...',
  processingLabel: 'Reviewing the current Lamina context...',
  suggestions: ['What can Lamina help with?'],
  onSubmit: async () =>
    'Lamina can help you ask the physician network, find specialists, and work with your current patient context.',
}

export default function App() {
  const { identity, signIn, signOut } = useDemoSession()
  const [nav, setNav] = useState<NavKey>('home')
  const [physician, setPhysician] = useState<AgentDetails | null>(null)
  const [signInProfiles, setSignInProfiles] = useState<AgentDetails[]>([])
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null)
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null)
  const [connectedIds, setConnectedIds] = useState<string[]>([])
  const [askConfiguration, setAskConfiguration] = useState<AskLaminaConfiguration>(
    DEFAULT_ASK_CONFIGURATION,
  )
  const [postComposerOpen, setPostComposerOpen] = useState(false)
  const [patientPostContext, setPatientPostContext] = useState<PatientPostContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true)
      setError(null)
      setPhysician(null)
      setOrganization(null)
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
        setConnectedIds(getDemoConnections(identity.npi))
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
    setNav('home')
  }

  const toggleConnection = useCallback((physicianId: string) => {
    if (!identity) return
    setConnectedIds((current) => {
      const updated = current.includes(physicianId)
        ? current.filter((id) => id !== physicianId)
        : [...current, physicianId]
      saveDemoConnections(identity.npi, updated)
      return updated
    })
  }, [identity])

  const handleSignOut = () => {
    setNav('home')
    setFocusedPostId(null)
    setPhysician(null)
    setOrganization(null)
    setConnectedIds([])
    setAskConfiguration(DEFAULT_ASK_CONFIGURATION)
    setPostComposerOpen(false)
    setPatientPostContext(null)
    signOut()
  }

  if (!identity) {
    return (
      <SignInPage
        profiles={signInProfiles}
        loading={loading}
        error={error}
        onContinue={(npi) => {
          setNav('home')
          setFocusedPostId(null)
          setPatientPostContext(null)
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
        onNavigate={(key) => {
          setFocusedPostId(null)
          setAskConfiguration(DEFAULT_ASK_CONFIGURATION)
          if (key !== 'patients') setPatientPostContext(null)
          setNav(key)
        }}
        onPost={() => setPostComposerOpen(true)}
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
            onAskChange={setAskConfiguration}
            onPatientContextChange={setPatientPostContext}
          />
        )}
        {!loading && physician && !error && nav === 'home' && (
          <NetworkPage
            focusedPostId={focusedPostId}
            physician={physician}
            connectedIds={connectedIds}
            onToggleConnection={toggleConnection}
            onAskChange={setAskConfiguration}
          />
        )}
        {!loading && physician && !error && nav === 'publication' && (
          <ReviewInboxPage
            focusedPostId={focusedPostId}
            physician={physician}
            onApproved={openNetworkPost}
            onAskChange={setAskConfiguration}
          />
        )}
        {!loading && physician && !error && nav === 'setup' && (
          <AgentSetupPage
            physician={physician}
            medplumStatus={organization?.medplum_connection_status ?? null}
            onAgentUpdated={setPhysician}
            onAskChange={setAskConfiguration}
          />
        )}
        {!loading && physician && !error && nav === 'connections' && (
          <ConnectionsPage
            connectedIds={connectedIds}
            onToggleConnection={toggleConnection}
            onAskChange={setAskConfiguration}
          />
        )}
        {!loading && physician && !error && nav === 'physicians' && (
          <PhysiciansPage
            connectedIds={connectedIds}
            onToggleConnection={toggleConnection}
            onAskChange={setAskConfiguration}
          />
        )}
        {!loading && physician && !error && nav === 'profile' && (
          <ProfilePage
            physician={physician}
            organization={organization}
            onAskChange={setAskConfiguration}
          />
        )}
      </main>
      {!loading && physician && !error && (
        <RightRail
          physician={physician}
          configuration={askConfiguration}
        />
      )}
      </div>
      {postComposerOpen && physician && (
        <PostComposerModal
          physician={physician}
          patientContext={patientPostContext}
          onClose={() => setPostComposerOpen(false)}
          onPublished={(post) => {
            setPostComposerOpen(false)
            setPatientPostContext(null)
            openNetworkPost(post.id)
          }}
        />
      )}
    </div>
  )
}
