export const DEMO_SESSION_STORAGE_KEY = 'lamina_demo_session_npi'

export interface DemoIdentity {
  npi: string
  agentId: string
}

export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  { npi: '9000000999', agentId: 'agent-9000000999' },
  { npi: '9000001000', agentId: 'agent-9000001000' },
] as const

export function getDemoIdentity(npi: string | null): DemoIdentity | null {
  return DEMO_IDENTITIES.find((identity) => identity.npi === npi) ?? null
}

export function clearDemoUiState(): void {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith('lamina.patientPost.') || key?.startsWith('lamina.selectedPatientRef.')) {
      window.localStorage.removeItem(key)
    }
  }
}
