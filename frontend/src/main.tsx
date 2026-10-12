import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadConfig } from './lib/api'

// Load runtime config first: App reads the base domain when it initialises.
await loadConfig()
const { default: App } = await import('./App.tsx')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
