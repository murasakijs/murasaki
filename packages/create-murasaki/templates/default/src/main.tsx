import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter, installClientRpc, ThemeProvider } from 'murasaki'
import { routes } from 'virtual:murasaki/routes'
import './globals.css'

installClientRpc()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AppRouter routes={routes} />
    </ThemeProvider>
  </StrictMode>,
)
