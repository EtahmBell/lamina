import { SHOWCASE_PHYSICIANS } from './showcaseFeed'

// Demo-only browser persistence for synthetic showcase connections.
// It has no effect on clinical authorization, Medplum access, or backend workflows.
export const DEMO_CONNECTIONS_STORAGE_KEY = 'lamina_demo_connections'

type StoredConnections = Record<string, string[]>

function readStore(): StoredConnections {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DEMO_CONNECTIONS_STORAGE_KEY) ?? '{}',
    ) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as StoredConnections) : {}
  } catch {
    return {}
  }
}

export function getDemoConnections(physicianNpi: string): string[] {
  const allowed = new Set(SHOWCASE_PHYSICIANS.map((physician) => physician.id))
  return (readStore()[physicianNpi] ?? []).filter(
    (id) => allowed.has(id) || /^\d{10}$/.test(id),
  )
}

export function saveDemoConnections(physicianNpi: string, connectionIds: string[]): void {
  const store = readStore()
  store[physicianNpi] = Array.from(new Set(connectionIds))
  window.localStorage.setItem(DEMO_CONNECTIONS_STORAGE_KEY, JSON.stringify(store))
}
