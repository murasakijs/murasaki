// src/app/page.tsx — the "/" route.

import { Link } from 'murasaki'
import {
  useClipboard,
  useDialog,
  useFs,
  useNotification,
  useShell,
  useState,
} from 'murasaki/jsx/dom'

export default function HomePage() {
  const [count, setCount] = useState(0)
  const [fileContent, setFileContent] = useState('')
  const [filePath, setFilePath] = useState('')

  const notify = useNotification()
  const clipboard = useClipboard()
  const shell = useShell()
  const dialog = useDialog()
  const fs = useFs()

  async function pickAndRead() {
    const paths = await dialog.openFile({ title: 'Pick a text file' })
    if (paths.length === 0) return
    const path = paths[0]
    const text = await fs.readFile(path)
    setFilePath(path)
    setFileContent(text.slice(0, 500)) // first 500 chars
  }

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
        <button onClick={() => notify({ title: 'Hello', body: `Count: ${count}` })}>
          🔔 Notify
        </button>
        <button onClick={() => clipboard.write(`Count: ${count}`)}>
          📋 Copy to clipboard
        </button>
        <button onClick={() => shell.openExternal('https://github.com/murasakijs/murasaki')}>
          🔗 Open repo
        </button>
        <button onClick={pickAndRead}>📂 Pick & read file</button>
      </div>

      {filePath && (
        <div className="file-preview">
          <p className="hint">
            <code>{filePath}</code>
          </p>
          <pre>{fileContent}</pre>
        </div>
      )}

      <nav className="links">
        <Link href="/about">About →</Link>
      </nav>
    </main>
  )
}
