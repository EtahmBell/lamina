import { useEffect, useState } from 'react'
import {
  getAgent,
  getOrganizationMembers,
  getOrganizations,
  type AgentDetails,
  type OrganizationSummary,
} from './api/client'
import { NetworkPage } from './components/NetworkPage'
import { PatientsPage } from './components/PatientsPage'
import { ProfilePage } from './components/ProfilePage'
import { ReviewInboxPage } from './components/ReviewInboxPage'
import { Sidebar, type NavKey } from './components/Sidebar'
import { ErrorBanner, PageLoading } from './components/ui'
import { demoSession } from './session'
import { displayError } from './utils'

export default function App() {
  const [nav, setNav] = useState<NavKey>('patients')
  const [physician, setPhysician] = useState<AgentDetails | null>(null)
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null)
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadSession = async () => {
      setLoading(true)
      setError(null)
      try {
        const [agent, organizations] = await Promise.all([
          getAgent(demoSession.currentPhysician.agentId),
          getOrganizations(),
        ])
        setPhysician(agent)
        const membershipResults = await Promise.all(
          organizations.map(async (item) => ({
            organization: item,
            members: await getOrganizationMembers(item.id),
          })),
        )
        setOrganization(
          membershipResults.find(({ members }) =>
            members.some(
              (member) => member.physician_npi === demoSession.currentPhysician.npi,
            ),
          )?.organization ?? null,
        )
      } catch (loadError) {
        setError(displayError(loadError))
      } finally {
        setLoading(false)
      }
    }
    void loadSession()
  }, [])

  const openNetworkPost = (postId: string) => {
    setFocusedPostId(postId)
    setNav('network')
  }

  const openReview = (postId: string) => {
    setFocusedPostId(postId)
    setNav('reviews')
  }

  return (
    <div className="flex h-full bg-slate-50">
      <Sidebar active={nav} physician={physician} onNavigate={setNav} />
      <main className="scrollbar-thin min-w-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="mx-auto max-w-5xl px-6 py-8">
            <PageLoading>Loading your Lamina session...</PageLoading>
          </div>
        )}
        {!loading && error && (
          <div className="mx-auto max-w-3xl px-6 py-8">
            <ErrorBanner message={error} />
            <p className="mt-3 text-sm text-slate-500">
              Lamina does not fall back to mocked physician or patient data when the backend is unavailable.
            </p>
          </div>
        )}
        {!loading && physician && !error && nav === 'patients' && (
          <PatientsPage
            physician={physician}
            onOpenNetwork={openNetworkPost}
            onOpenReviews={openReview}
          />
        )}
        {!loading && physician && !error && nav === 'network' && (
          <NetworkPage
            focusedPostId={focusedPostId}
            viewerPhysicianNpi={physician.physician_npi}
          />
        )}
        {!loading && physician && !error && nav === 'reviews' && (
          <ReviewInboxPage focusedPostId={focusedPostId} onApproved={openNetworkPost} />
        )}
        {!loading && physician && !error && nav === 'profile' && (
          <ProfilePage physician={physician} organization={organization} />
        )}
      </main>
    </div>
  )
}
