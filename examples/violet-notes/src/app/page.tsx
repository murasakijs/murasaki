import { useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenuTrigger, useContextMenu } from 'murasaki'
import type { Metadata } from 'murasaki'
import {
  Check,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Save,
  Trash2,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Violet Notes',
}

type Note = { id: string; title: string; body: string; updatedAt: number }

const seedNotes: Note[] = [
  {
    id: 'quiet-desktop',
    title: 'Ideas for a quieter desktop',
    updatedAt: Date.now(),
    body: `# Ideas for a quieter desktop

## Goals
- Reduce visual noise
- Clarify hierarchy
- Keep focus on the task
- Respect system behavior

## Principles
- Default to calm
- Reveal on demand
- Use color with restraint
- Make state visible, not loud

## Next steps
- Try a grayscale pass
- Validate with real tasks
- Iterate based on friction`,
  },
  { id: 'product-notes', title: 'Product notes', updatedAt: Date.now() - 2000, body: '# Product notes\n\nNative menus should feel inevitable, not ornamental.' },
  { id: 'release-checklist', title: 'Release checklist', updatedAt: Date.now() - 4000, body: '# Release checklist\n\n- Verify the build\n- Test the installer\n- Publish checksums' },
  { id: 'scratchpad', title: 'Scratchpad', updatedAt: Date.now() - 6000, body: '# Scratchpad\n\nA place for unfinished thoughts.' },
]

function readStoredNotes(): Note[] {
  try {
    const value = localStorage.getItem('murasaki-showcase:notes')
    return value ? (JSON.parse(value) as Note[]) : seedNotes
  } catch {
    return seedNotes
  }
}

function MarkdownPreview({ source }: { source: string }) {
  const lines = source.split('\n')
  return (
    <div className="markdown-preview">
      {lines.map((line, index) => {
        if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>
        if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>
        if (line.startsWith('- ')) return <div className="markdown-bullet" key={index}><span>•</span>{line.slice(2)}</div>
        if (!line) return <div className="markdown-gap" key={index} />
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>(readStoredNotes)
  const [selectedId, setSelectedId] = useState(notes[0]?.id ?? '')
  const [saved, setSaved] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const selected = notes.find((note) => note.id === selectedId) ?? notes[0]

  const persist = (next: Note[]) => {
    setNotes(next)
    localStorage.setItem('murasaki-showcase:notes', JSON.stringify(next))
    setSaved(true)
  }

  const createNote = () => {
    const now = Date.now()
    const note = { id: `note-${now}`, title: 'Untitled note', body: '# Untitled note\n\nStart writing…', updatedAt: now }
    persist([note, ...notes])
    setSelectedId(note.id)
  }

  const deleteSelected = () => {
    if (notes.length === 1 || !selected) return
    const next = notes.filter((note) => note.id !== selected.id)
    persist(next)
    setSelectedId(next[0].id)
  }

  const duplicateSelected = () => {
    if (!selected) return
    const copy = { ...selected, id: `note-${Date.now()}`, title: `${selected.title} copy`, updatedAt: Date.now() }
    persist([copy, ...notes])
    setSelectedId(copy.id)
  }

  useContextMenu('note-row', [
    { label: 'Duplicate note', action: duplicateSelected },
    { separator: true },
    { label: 'Delete note', action: deleteSelected, disabled: notes.length === 1 },
  ])

  useEffect(() => {
    if (saved) return
    const timer = window.setTimeout(() => persist(notes), 500)
    return () => window.clearTimeout(timer)
  }, [notes, saved])

  const title = useMemo(() => selected?.body.match(/^#\s+(.+)$/m)?.[1] ?? selected?.title ?? '', [selected])

  const updateBody = (body: string) => {
    setNotes((current) => current.map((note) => note.id === selectedId ? { ...note, title: body.match(/^#\s+(.+)$/m)?.[1] ?? note.title, body, updatedAt: Date.now() } : note))
    setSaved(false)
  }

  const exportSelected = () => {
    if (!selected) return
    const url = URL.createObjectURL(new Blob([selected.body], { type: 'text/markdown' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selected.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importNote = async (file?: File) => {
    if (!file) return
    const body = await file.text()
    const note: Note = { id: `note-${Date.now()}`, title: body.match(/^#\s+(.+)$/m)?.[1] ?? file.name.replace(/\.md$/i, ''), body, updatedAt: Date.now() }
    persist([note, ...notes])
    setSelectedId(note.id)
  }

  return (
    <main className="notes-app">
      <header className="notes-toolbar">
        <div className="notes-titlebar">
          <span className="pixel-butterfly" aria-hidden>✵</span>
          <strong>Violet Notes</strong>
        </div>
        <div className="toolbar-actions">
          <button onClick={createNote}><FilePlus2 size={16} /> New</button>
          <button onClick={() => fileInput.current?.click()}><FolderOpen size={16} /> Import</button>
          <button onClick={exportSelected}><Download size={16} /> Export</button>
          <button onClick={() => persist(notes)} disabled={saved}><Save size={16} /> Save</button>
          <input ref={fileInput} type="file" accept=".md,.txt,text/plain,text/markdown" hidden onChange={(event) => void importNote(event.target.files?.[0])} />
        </div>
      </header>

      <div className="notes-workspace">
        <aside className="notes-sidebar">
          <div className="sidebar-label">LOCAL NOTES</div>
          <div className="note-list">
            {notes.map((note) => (
              <ContextMenuTrigger id="note-row" key={note.id}>
                <button className={`note-row ${note.id === selectedId ? 'is-selected' : ''}`} onClick={() => setSelectedId(note.id)}>
                  <FileText size={15} />
                  <span>{note.title}</span>
                </button>
              </ContextMenuTrigger>
            ))}
          </div>
          <div className="notes-sidebar-footer">
            <button onClick={deleteSelected} disabled={notes.length === 1}><Trash2 size={15} /> Delete selected</button>
          </div>
        </aside>

        <section className="notes-editor">
          <div className="editor-header"><strong>{title}</strong><span>Markdown</span></div>
          <div className="editor-grid">
            <div className="editor-input-wrap">
              <div className="line-gutter" aria-hidden>{selected?.body.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div>
              <textarea value={selected?.body ?? ''} onChange={(event) => updateBody(event.target.value)} spellCheck={false} aria-label="Markdown editor" />
            </div>
            <MarkdownPreview source={selected?.body ?? ''} />
          </div>
        </section>
      </div>

      <footer className="notes-status">
        <span className={saved ? 'is-saved' : ''}>{saved ? <Check size={13} /> : null}{saved ? 'Saved locally' : 'Saving…'}</span>
        <span>Right-click any note for a native OS menu</span>
      </footer>
    </main>
  )
}
