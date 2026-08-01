import { useMemo, useState, type ReactNode } from 'react'
import { DemoSessionContext, type DemoSessionContextValue } from './DemoSessionContext'
import {
  clearDemoUiState,
  DEMO_SESSION_STORAGE_KEY,
  getDemoIdentity,
  type DemoIdentity,
} from './session'

function readStoredIdentity(): DemoIdentity | null {
  const storedNpi = window.localStorage.getItem(DEMO_SESSION_STORAGE_KEY)
  const identity = getDemoIdentity(storedNpi)
  if (!identity && storedNpi) window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY)
  return identity
}

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<DemoIdentity | null>(readStoredIdentity)

  const value = useMemo<DemoSessionContextValue>(
    () => ({
      identity,
      signIn: (npi: string) => {
        const selected = getDemoIdentity(npi)
        if (!selected) throw new Error('This profile is not an allowed synthetic demo identity.')
        window.localStorage.setItem(DEMO_SESSION_STORAGE_KEY, selected.npi)
        setIdentity(selected)
      },
      signOut: () => {
        window.localStorage.removeItem(DEMO_SESSION_STORAGE_KEY)
        clearDemoUiState()
        setIdentity(null)
      },
    }),
    [identity],
  )

  return <DemoSessionContext.Provider value={value}>{children}</DemoSessionContext.Provider>
}
