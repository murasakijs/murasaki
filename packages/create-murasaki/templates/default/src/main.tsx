import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter, installClientRpc, ThemeProvider } from 'murasaki'
import { routes, middleware } from 'virtual:murasaki/routes'
import '@murasakijs/ui/styles.css'
import './globals.css'

installClientRpc()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AppRouter routes={routes} middleware={middleware} />
    </ThemeProvider>
  </StrictMode>,
)
