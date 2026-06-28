// src/app/page.tsx — the "/" route.

import { Link } from 'murasaki'

export default function HomePage() {
  return (
    <main>
      <h1>Hello, Murasaki 🦋</h1>
      <p>
        This view lives in <code>src/app/page.tsx</code>.
      </p>
      <p className="hint">Edit the file and the window reloads instantly.</p>
      <nav className="links">
        <Link href="/about">About →</Link>
      </nav>
    </main>
  )
}
