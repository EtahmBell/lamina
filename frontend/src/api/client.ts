const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

if (!configuredApiBaseUrl) {
  throw new Error('VITE_API_BASE_URL must be configured for the Lamina frontend.')
}
if (import.meta.env.PROD && !configuredApiBaseUrl.startsWith('https://')) {
  throw new Error('VITE_API_BASE_URL must use HTTPS in a production frontend build.')
}

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/$/, '')

export const DEMO = {
  organizationId: 'org-lamina-demo-medical-group',
  ethan: { npi: '9000000999', agentId: 'agent-9000000999' },
  lianne: { npi: '9000001000', agentId: 'agent-9000001000' },
} as const

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

export interface MedplumHealth {
  configured: boolean
  authenticated: boolean
  fhir_reachable: boolean
  project_id_configured: boolean
  status: string
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

export interface CaseContext {
  patient_id: string
  synthetic: boolean
  age_band: string
  conditions: ConditionContext[]
  medications: MedicationContext[]
  observations: ObservationContext[]
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
    execution_trace: string[]
  }
}

export interface ExportResult {
  post_id: string
  status: string
  exported_at: string
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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

export function testMedplumIntegration(organizationId: string): Promise<MedplumHealth> {
  return request(`/organizations/${encodeURIComponent(organizationId)}/integrations/medplum/test`, {
    method: 'POST',
  })
}

export async function getAgentCases(agentId: string): Promise<CaseContext[]> {
  const result = await request<{ cases: CaseContext[] }>(
    `/agents/${encodeURIComponent(agentId)}/medplum/cases`,
  )
  return result.cases
}

export function generateForumPost(
  patientId: string,
  physicianGuidance: string,
): Promise<ForumPost> {
  return request(`/medplum/patients/${encodeURIComponent(patientId)}/forum-posts/generate`, {
    method: 'POST',
    body: JSON.stringify({
      agent_id: DEMO.ethan.agentId,
      physician_guidance: physicianGuidance,
    }),
  })
}

export function approveForumPost(postId: string): Promise<ForumPost> {
  return request(`/forum/posts/${encodeURIComponent(postId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ physician_npi: DEMO.ethan.npi }),
  })
}

export function getForumPost(postId: string): Promise<ForumPost> {
  const params = new URLSearchParams({ viewer_physician_npi: DEMO.ethan.npi })
  return request(`/forum/posts/${encodeURIComponent(postId)}?${params}`)
}

export async function getForumFeed(): Promise<ForumPost[]> {
  const params = new URLSearchParams({
    status: 'published',
    author_physician_npi: DEMO.ethan.npi,
    limit: '20',
  })
  const result = await request<{ posts: ForumPost[] }>(`/forum/posts?${params}`)
  return result.posts
}

export function monitorForumPost(postId: string): Promise<MonitoringResponse> {
  return request(`/forum/posts/${encodeURIComponent(postId)}/monitor`, { method: 'POST' })
}

export function getReviewInbox(physicianNpi: string): Promise<ReviewInbox> {
  return request(`/physicians/${encodeURIComponent(physicianNpi)}/review-inbox`)
}

export function getGroundingReview(responseId: string): Promise<GroundingReview> {
  const params = new URLSearchParams({ physician_npi: DEMO.lianne.npi })
  return request(`/forum/responses/${encodeURIComponent(responseId)}/grounding-review?${params}`)
}

export function approveForumResponse(responseId: string): Promise<ForumResponse> {
  return request(`/forum/responses/${encodeURIComponent(responseId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ physician_npi: DEMO.lianne.npi }),
  })
}

export async function getExportStatus(
  postId: string,
): Promise<{ linked: boolean; exported: boolean }> {
  try {
    const result = await request<{ exported_at: string | null }>(
      `/forum/posts/${encodeURIComponent(postId)}/medplum-link`,
    )
    return { linked: true, exported: Boolean(result.exported_at) }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { linked: false, exported: false }
    }
    throw error
  }
}

export async function exportForumPost(postId: string): Promise<ExportResult> {
  const result = await request<ExportResult & { medplum_patient_id: string; communication_id: string }>(
    `/forum/posts/${encodeURIComponent(postId)}/export-to-medplum`,
    { method: 'POST' },
  )
  return { post_id: result.post_id, status: result.status, exported_at: result.exported_at }
}
