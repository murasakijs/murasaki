// src/app/about/page.tsx — the "/about" route.

import { Link } from 'murasaki'

export default function AboutPage() {
  return (
    <main>
      <h1>About 🦋</h1>
      <p>
        Murasaki is a Next.js-inspired desktop framework. Node-powered, WebView-thin, no Rust, no
        Chromium.
      </p>
      <nav className="links">
        <Link href="/">← Back home</Link>
      </nav>
    </main>
  )
}
