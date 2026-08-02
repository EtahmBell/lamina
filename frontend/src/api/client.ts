const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

if (!configuredApiBaseUrl) {
  throw new Error('VITE_API_BASE_URL must be configured for the Lamina frontend.')
}
if (import.meta.env.PROD && !configuredApiBaseUrl.startsWith('https://')) {
  throw new Error('VITE_API_BASE_URL must use HTTPS in a production frontend build.')
}

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/$/, '')

export interface AgentConfiguration {
  verified_specialties: string[]
  declared_expertise_tags: string[]
  monitoring_topics: string[]
  voice_post_drafting_enabled: boolean
  response_drafting_enabled: boolean
  thread_summaries_enabled: boolean
  citations_required: boolean
  publication_mode: 'requires_physician_approval'
  report_cadence: 'none' | 'weekly' | 'monthly'
  report_topics: string[]
  report_source_scope: 'network' | 'medplum' | 'network_and_medplum'
  report_length: 'brief' | 'detailed'
  notifications: Array<
    'draft_response_ready' | 'reply_to_my_question' | 'clarification_requested' | 'report_ready'
  >
}

export type AgentConfigurationUpdate = Omit<AgentConfiguration, 'verified_specialties'>

export interface AgentDetails {
  id: string
  physician_npi: string
  status: string
  physician: {
    npi: string
    display_name: string
    primary_specialty: string
    primary_taxonomy_code: string
    data_source: string
    profile_status: string
  }
  claim: { status: string; verified_at: string | null } | null
  configuration: AgentConfiguration | null
  effective_permissions: {
    can_draft_voice_posts: boolean
    can_draft_responses: boolean
    can_generate_reports: boolean
    can_publish_clinical_content: boolean
    requires_physician_approval: boolean
  }
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  status: string
  member_count: number
  medplum_connection_status: string | null
}

export interface OrganizationMember {
  physician_npi: string
  physician_name: string
  agent_id: string
  role: string
  status: string
  verified_specialty: string
}

export interface MedplumIntegration {
  organization_id: string
  configured: boolean
  connection_type: string
  credential_source: string
  status: string
  base_url: string
  project_id_configured: boolean
  last_verified_at: string | null
  last_error_category: string | null
}

export interface PatientSummary {
  patient_ref: string
  display_name: string
  synthetic: boolean
  age_band: string
  summary: string
}

export interface ConditionContext {
  display: string
  clinical_status: string
}

export interface MedicationContext {
  display: string
  status: string
  timing_summary: string
}

export interface ObservationContext {
  display: string
  value_summary: string
  effective_date: string
}

export interface PatientCaseContext {
  patient_ref: string
  display_name: string
  synthetic: boolean
  age_band: string
  conditions: ConditionContext[]
  medications: MedicationContext[]
  observations: ObservationContext[]
}

export interface ReferralCandidate {
  npi: string
  name: string
  specialty: string
  city: string
  state: string
  connection_status: 'connected' | 'not_connected'
  lamina_status: string
  why: string[]
}

export interface ReferralRecommendations {
  specialty: string
  reason: string
  candidates: ReferralCandidate[]
}

export interface ForumAuthor {
  physician_npi: string
  physician_name: string
  verified_specialty: string
  organization: string
  agent_id: string
}

export interface GroundingProvenance {
  grounding_mode: string | null
  source_system: string | null
  matched_case_count: number
}

export interface ForumResponse {
  id: string
  post_id: string
  response_type: string
  headline: string
  content: string
  citations: string[]
  status: string
  author: ForumAuthor
  provenance: {
    drafted_by_agent: boolean
    draft_origin: string
    physician_approved: boolean
    approved_at: string | null
    prompt_version: string | null
    model: string | null
    generated_at: string | null
    grounding: GroundingProvenance
  }
  created_at: string
  updated_at: string
  published_at: string | null
}

export interface ForumPost {
  id: string
  title: string
  clinical_question: string
  context_summary: string
  specialty_tags: string[]
  case_classification: string
  status: string
  author: ForumAuthor
  provenance: {
    drafted_by_agent: boolean
    draft_origin: string
    physician_approved: boolean
    approved_at: string | null
    prompt_version: string | null
    model: string | null
    generated_at: string | null
    grounding?: GroundingProvenance
  }
  created_at: string
  updated_at: string
  published_at: string | null
  published_response_count: number
  responses: ForumResponse[]
}

export interface ReviewInbox {
  physician_npi: string
  counts: { posts: number; responses: number }
  post_drafts: ForumPost[]
  response_drafts: ForumResponse[]
}

export interface MonitoringResult {
  agent_id: string
  physician_name: string
  candidate: boolean
  monitoring_run_id: string
  outcome: 'skipped' | 'no_relevant_case' | 'draft_created' | 'failed'
  matched_case_count: number
  response_id: string | null
  safe_error_category: string | null
}

export interface MonitoringResponse {
  post_id: string
  agents_evaluated: number
  results: MonitoringResult[]
}

export interface GroundingReview {
  response: ForumResponse
  grounding: {
    grounding_mode: string
    source_system: string
    matched_case_count: number
    relevance_reason: string
    similarities: string[]
    differences: string[]
    unknowns: string[]
  }
}

export interface PhysicianDirectoryResult {
  npi: string
  display_name: string
  primary_specialty: string
  city: string
  state: string
  source: string
  profile_status: string
  agent_id: string
  agent_status: string
  claimed: number
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface DeepgramTemporaryToken {
  access_token: string
  expires_in: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Lamina backend is unavailable. Confirm that FastAPI is running.')
  }

  const payload = (await response.json().catch(() => null)) as
    | { detail?: string | Array<{ msg?: string }> }
    | null
  if (!response.ok) {
    const detail = payload?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg).filter(Boolean).join('; ')
          : `Request failed with HTTP ${response.status}`
    throw new ApiError(response.status, message || `Request failed with HTTP ${response.status}`)
  }
  return payload as T
}

export function getAgent(agentId: string): Promise<AgentDetails> {
  return request(`/agents/${encodeURIComponent(agentId)}`)
}

export function getDeepgramTemporaryToken(): Promise<DeepgramTemporaryToken> {
  return request('/integrations/deepgram/token', { method: 'POST' })
}

export function saveAgentConfiguration(
  agentId: string,
  configuration: AgentConfigurationUpdate,
): Promise<AgentDetails> {
  return request(`/agents/${encodeURIComponent(agentId)}/configuration`, {
    method: 'PUT',
    body: JSON.stringify(configuration),
  })
}

export async function getOrganizations(): Promise<OrganizationSummary[]> {
  const result = await request<{ organizations: OrganizationSummary[] }>('/organizations')
  return result.organizations
}

export async function getOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const result = await request<{ members: OrganizationMember[] }>(
    `/organizations/${encodeURIComponent(organizationId)}/members`,
  )
  return result.members
}

export function getMedplumIntegration(organizationId: string): Promise<MedplumIntegration> {
  return request(`/organizations/${encodeURIComponent(organizationId)}/integrations/medplum`)
}

export async function getMyPatients(physicianNpi: string): Promise<PatientSummary[]> {
  const result = await request<{ patients: PatientSummary[] }>(
    `/physicians/${encodeURIComponent(physicianNpi)}/patients`,
  )
  return result.patients
}

export function getPatientCaseContext(
  physicianNpi: string,
  patientRef: string,
): Promise<PatientCaseContext> {
  return request(
    `/physicians/${encodeURIComponent(physicianNpi)}/patients/${encodeURIComponent(patientRef)}/case-context`,
  )
}

export function getReferralRecommendations(
  referringPhysicianNpi: string,
  patientRef: string,
  connectedPhysicianNpis: string[],
): Promise<ReferralRecommendations> {
  return request('/referrals/recommendations', {
    method: 'POST',
    body: JSON.stringify({
      referring_physician_npi: referringPhysicianNpi,
      patient_ref: patientRef,
      connected_physician_npis: connectedPhysicianNpis,
    }),
  })
}

export function generatePatientForumPost(
  physicianNpi: string,
  patientRef: string,
  physicianGuidance: string,
): Promise<ForumPost> {
  return request(
    `/physicians/${encodeURIComponent(physicianNpi)}/patients/${encodeURIComponent(patientRef)}/forum-posts/generate`,
    {
      method: 'POST',
      body: JSON.stringify({ physician_guidance: physicianGuidance }),
    },
  )
}

export interface ManualForumPostDraft {
  agent_id: string
  title: string
  clinical_question: string
  context_summary: string
  specialty_tags: string[]
  case_classification: 'synthetic'
  draft_origin: 'physician_text_request'
}

export function createForumPostDraft(draft: ManualForumPostDraft): Promise<ForumPost> {
  return request('/forum/posts/drafts', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export function approveForumPost(
  postId: string,
  physicianNpi: string,
): Promise<ForumPost> {
  return request(`/forum/posts/${encodeURIComponent(postId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ physician_npi: physicianNpi }),
  })
}

export function getForumPost(postId: string, viewerPhysicianNpi?: string): Promise<ForumPost> {
  const query = viewerPhysicianNpi
    ? `?${new URLSearchParams({ viewer_physician_npi: viewerPhysicianNpi })}`
    : ''
  return request(`/forum/posts/${encodeURIComponent(postId)}${query}`)
}

export async function getForumFeed(query?: string): Promise<ForumPost[]> {
  const params = new URLSearchParams({ status: 'published', limit: '100' })
  if (query) params.set('q', query)
  const result = await request<{ posts: ForumPost[] }>(`/forum/posts?${params}`)
  return result.posts
}

export function monitorForumPost(postId: string): Promise<MonitoringResponse> {
  return request(`/forum/posts/${encodeURIComponent(postId)}/monitor`, { method: 'POST' })
}

export function getReviewInbox(physicianNpi: string): Promise<ReviewInbox> {
  return request(`/physicians/${encodeURIComponent(physicianNpi)}/review-inbox`)
}

export function getGroundingReview(
  responseId: string,
  physicianNpi: string,
): Promise<GroundingReview> {
  const params = new URLSearchParams({ physician_npi: physicianNpi })
  return request(`/forum/responses/${encodeURIComponent(responseId)}/grounding-review?${params}`)
}

export function approveForumResponse(
  responseId: string,
  physicianNpi: string,
): Promise<ForumResponse> {
  return request(`/forum/responses/${encodeURIComponent(responseId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ physician_npi: physicianNpi }),
  })
}

export async function searchPhysicians(
  query: string,
  state?: string,
): Promise<PhysicianDirectoryResult[]> {
  const params = new URLSearchParams({ q: query, limit: '20' })
  if (state) params.set('state', state)
  const result = await request<{ results: PhysicianDirectoryResult[] }>(
    `/physicians/search?${params}`,
  )
  return result.results
}

export function getPhysicianProfile(npi: string): Promise<PhysicianDirectoryResult> {
  return request(`/physicians/${encodeURIComponent(npi)}`)
}
