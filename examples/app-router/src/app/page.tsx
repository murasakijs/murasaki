// src/app/page.tsx — the "/" route.
//
// useState is imported from murasaki/jsx/dom. On the server it returns the
// initial value with a no-op setter (so SSR works); in the WebView the
// client bundle hydrates and the setter triggers re-renders.

import { Link } from 'murasaki'
import { useState } from 'murasaki/jsx/dom'

export default function HomePage() {
  const [count, setCount] = useState(0)
  return (
    <main>
      <h1>Hello, Murasaki 🦋</h1>
      <p>
        This view lives in <code>src/app/page.tsx</code>.
      </p>

      <div className="counter">
        <button onClick={() => setCount(count - 1)} aria-label="decrement">
          −
        </button>
        <strong>{count}</strong>
        <button onClick={() => setCount(count + 1)} aria-label="increment">
          +
        </button>
      </div>

      <p className="hint">
        Click the buttons — that's <code>useState</code> from
        <code>murasaki/jsx/dom</code> running inside the WebView.
      </p>

      <nav className="links">
        <Link href="/about">About →</Link>
      </nav>
    </main>
  )
}
