// src/app/page.tsx — the "/" route.

import { Link } from 'murasaki'
import {
  useClipboard,
  useNotification,
  useShell,
  useState,
} from 'murasaki/jsx/dom'

export default function HomePage() {
  const [count, setCount] = useState(0)
  const [clipText, setClipText] = useState('')
  const notify = useNotification()
  const clipboard = useClipboard()
  const shell = useShell()

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

      <div className="actions">
        <button
          onClick={() =>
            notify({ title: 'Murasaki', body: `Counter is at ${count}`, sound: true })
          }
        >
          🔔 Send notification
        </button>
        <button
          onClick={async () => {
            await clipboard.write(`Counter value: ${count}`)
            const text = await clipboard.read()
            setClipText(text)
          }}
        >
          📋 Copy &amp; read clipboard
        </button>
        <button onClick={() => shell.openExternal('https://github.com/murasakijs/murasaki')}>
          🔗 Open repo
        </button>
      </div>

      {clipText && (
        <p className="hint">
          Last clipboard read: <code>{clipText}</code>
        </p>
      )}

      <nav className="links">
        <Link href="/about">About →</Link>
      </nav>
    </main>
  )
}
