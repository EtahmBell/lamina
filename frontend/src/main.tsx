import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DemoSessionProvider } from './DemoSessionProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoSessionProvider>
      <App />
    </DemoSessionProvider>
  </StrictMode>,
)
