// Demo-only scheduling preference. Lamina has no background scheduler yet.
// Backend configuration remains authoritative for whether response drafting is enabled.
export type ActivityFrequency = 'off' | 'weekly' | 'three_times_weekly' | 'daily'

const STORAGE_KEY = 'lamina_demo_activity_frequency'

export function getActivityFrequency(
  physicianNpi: string,
  responseDraftingEnabled: boolean,
): ActivityFrequency {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>
    const value = stored[physicianNpi]
    if (value === 'off' || value === 'weekly' || value === 'three_times_weekly' || value === 'daily') {
      return value
    }
  } catch {
    // Fall through to the backend-derived default.
  }
  return responseDraftingEnabled ? 'three_times_weekly' : 'off'
}

export function saveActivityFrequency(physicianNpi: string, value: ActivityFrequency): void {
  let stored: Record<string, string> = {}
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>
  } catch {
    stored = {}
  }
  stored[physicianNpi] = value
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}
