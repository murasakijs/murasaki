import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installClientRpc, ThemeProvider } from 'murasaki'
import Layout from './app/layout'
import Page from './app/page'
import './globals.css'

installClientRpc()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Layout>
        <Page />
      </Layout>
    </ThemeProvider>
  </StrictMode>,
)
