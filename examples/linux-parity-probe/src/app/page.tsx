import type { Metadata } from 'murasaki'

export const metadata: Metadata = {
  title: 'Murasaki Linux Parity Probe',
}

/**
 * Home page. The full feature self-test runs from src/app/layout.tsx (which
 * survives every client-side navigation this probe performs) rather than
 * from here, so this page only needs to exist as the primary window's
 * initial route.
 */
export default function HomePage() {
  return <div data-probe="HOME_OK">Murasaki Linux Parity Probe</div>
}
