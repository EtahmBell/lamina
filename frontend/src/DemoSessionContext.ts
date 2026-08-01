import { createContext, useContext } from 'react'
import type { DemoIdentity } from './session'

export interface DemoSessionContextValue {
  identity: DemoIdentity | null
  signIn: (npi: string) => void
  signOut: () => void
}

export const DemoSessionContext = createContext<DemoSessionContextValue | null>(null)

export function useDemoSession(): DemoSessionContextValue {
  const context = useContext(DemoSessionContext)
  if (!context) throw new Error('useDemoSession must be used within DemoSessionProvider.')
  return context
}
