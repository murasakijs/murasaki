import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Check, FileAudio, FileText, GripVertical, Image as ImageIcon, Link2, Paperclip, Plus, Trash2 } from 'lucide-react'
import papelleIcon from '../assets/icon.png'
import type { Block, BlockType, Locale, Page } from '../domain/types'
import { t } from '../i18n'

interface BlockEditorProps {
  locale: Locale
  page: Page
  pages: Page[]
  workspaceBytes: number
  onOpenPage(id: string): void
  onChange(page: Page): void
}

function AttachmentPreview({ block }: { block: Block }) {
  const attachment = block.attachment
  if (!attachment) return <div className="attachment-missing"><Paperclip size={18} />{block.text}</div>
  // `papelle-icon` used `/src/assets/icon.png` before packaged builds exposed
  // the bug. Resolve by stable ID as well so existing saved workspaces repair
  // themselves without a destructive reset.
  const builtInPapelleIcon = attachment.id === 'papelle-icon'
    && (attachment.dataUrl === 'murasaki-asset:papelle-icon' || attachment.dataUrl === '/src/assets/icon.png')
  const source = builtInPapelleIcon ? papelleIcon : attachment.dataUrl
  if (attachment.mime.startsWith('image/')) return <figure className="attachment-card"><img src={source} alt={attachment.name} /><figcaption><ImageIcon size={15} />{attachment.name}<span>{Math.max(1, Math.round(attachment.size / 1024))} KB</span></figcaption></figure>
  if (attachment.mime.startsWith('audio/')) return <div className="attachment-card audio"><FileAudio size={22} /><strong>{attachment.name}</strong><audio controls src={attachment.dataUrl} /></div>
  // Do not embed synced PDFs inside the privileged app WebView. A collaborator
  // may supply this record, and an inline PDF renderer unnecessarily widens
  // the attack surface. Keep the bounded attachment downloadable instead.
  if (attachment.mime === 'application/pdf') return <a className="attachment-card pdf" href={attachment.dataUrl} download={attachment.name}><FileText size={22} /><strong>{attachment.name}</strong></a>
  return <a className="attachment-missing" href={attachment.dataUrl} download={attachment.name}><Paperclip size={18} />{attachment.name}</a>
}

const stamp = () => new Date().toISOString()

export function BlockEditor({ locale, page, pages, workspaceBytes, onOpenPage, onChange }: BlockEditorProps) {
  const labels = t(locale)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const [dragging, setDragging] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<{ block: Block; index: number } | null>(null)
  const blockLabels: Record<Exclude<BlockType, 'attachment'>, string> = { heading: labels.heading, paragraph: labels.text, check: labels.todo, callout: labels.callout }

  const commit = (blocks: Block[]) => onChange({ ...page, blocks, updatedAt: stamp() })
  const updateBlock = (id: string, patch: Partial<Block>) => commit(page.blocks.map((item) => item.id === id ? { ...item, ...patch, updatedAt: stamp() } : item))
  const moveBlock = (id: string, delta: number) => {
    const from = page.blocks.findIndex((item) => item.id === id)
    const to = Math.max(0, Math.min(page.blocks.length - 1, from + delta))
    if (from < 0 || from === to) return
    const blocks = [...page.blocks]
    const [item] = blocks.splice(from, 1)
    blocks.splice(to, 0, item)
    commit(blocks)
    window.setTimeout(() => textareas.current.get(id)?.focus(), 0)
  }
  const dropBlock = (targetId: string) => {
    if (!dragging || dragging === targetId) return
    const from = page.blocks.findIndex((item) => item.id === dragging)
    const to = page.blocks.findIndex((item) => item.id === targetId)
    if (from < 0 || to < 0) return
    const blocks = [...page.blocks]
    const [item] = blocks.splice(from, 1)
    blocks.splice(to, 0, item)
    commit(blocks)
    setDragging(null)
  }
  const deleteBlock = (id: string) => {
    const index = page.blocks.findIndex((item) => item.id === id)
    if (index < 0) return
    setDeleted({ block: page.blocks[index], index })
    commit(page.blocks.filter((item) => item.id !== id))
  }
  const undoDelete = () => {
    if (!deleted) return
    const blocks = [...page.blocks]
    blocks.splice(Math.min(deleted.index, blocks.length), 0, deleted.block)
    commit(blocks)
    setDeleted(null)
  }
  const addBlock = (afterId?: string, text = '') => {
    const next: Block = { id: crypto.randomUUID(), type: 'paragraph', text, updatedAt: stamp() }
    const blocks = [...page.blocks]
    const index = afterId ? blocks.findIndex((item) => item.id === afterId) + 1 : blocks.length
    blocks.splice(Math.max(0, index), 0, next)
    commit(blocks)
    window.setTimeout(() => textareas.current.get(next.id)?.focus(), 0)
  }
  const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>, item: Block) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') { event.preventDefault(); moveBlock(item.id, -1); return }
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowDown') { event.preventDefault(); moveBlock(item.id, 1); return }
    if (event.key === 'Enter' && !event.shiftKey) {
      const target = event.currentTarget
      if (target.selectionStart === target.value.length) { event.preventDefault(); addBlock(item.id); return }
    }
    if (event.key === 'Backspace' && item.text === '' && page.blocks.length > 1) {
      event.preventDefault()
      const index = page.blocks.findIndex((block) => block.id === item.id)
      deleteBlock(item.id)
      window.setTimeout(() => textareas.current.get(page.blocks[Math.max(0, index - 1)]?.id)?.focus(), 0)
    }
  }
  const addAttachment = async (file?: File) => {
    if (!file) return
    const supported = file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type === 'application/pdf'
    const projected = Math.ceil(file.size * 4 / 3) + workspaceBytes + 32 * 1024
    if (!supported || file.size > 5 * 1024 * 1024 || projected > 24 * 1024 * 1024) return window.alert(labels.attachmentTooLarge)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(String(reader.result)))
        reader.addEventListener('error', () => reject(reader.error))
        reader.readAsDataURL(file)
      })
      commit([...page.blocks, { id: crypto.randomUUID(), type: 'attachment', text: file.name, updatedAt: stamp(), attachment: { id: crypto.randomUUID(), name: file.name, mime: file.type, size: file.size, dataUrl } }])
    } catch { window.alert(labels.attachmentReadFailed) }
  }

  return (
    <article className="document">
      <input className="document-title" value={page.title} onChange={(event) => onChange({ ...page, title: event.target.value, updatedAt: stamp() })} aria-label={labels.pageTitle} />
      <div className="blocks">
        {page.blocks.map((item) => {
          const links = [...item.text.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1])
          const commands = item.type !== 'attachment' && item.text.startsWith('/')
          return (
            <div className={`block block-${item.type} ${dragging === item.id ? 'is-dragging' : ''}`} key={item.id} onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={() => dropBlock(item.id)}>
              <button className="block-grip" draggable onDragStart={() => setDragging(item.id)} onDragEnd={() => setDragging(null)} onKeyDown={(event) => { if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); moveBlock(item.id, -1) } if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); moveBlock(item.id, 1) } }} aria-label={labels.dragBlock}><GripVertical size={16} /></button>
              {item.type !== 'attachment' ? <select className="block-type" value={item.type} onChange={(event) => updateBlock(item.id, { type: event.target.value as BlockType })} aria-label={labels.blockType}>{(Object.keys(blockLabels) as Array<keyof typeof blockLabels>).map((type) => <option value={type} key={type}>{blockLabels[type]}</option>)}</select> : <span />}
              <div className="block-content">
                {item.type === 'check' ? <div className="check-block"><input aria-label={labels.taskToggle} type="checkbox" checked={item.checked ?? false} onChange={(event) => updateBlock(item.id, { checked: event.target.checked })} /><span className="checkmark" aria-hidden>{item.checked ? <Check size={13} /> : null}</span><textarea aria-label={labels.blockText} ref={(node) => { if (node) textareas.current.set(item.id, node); else textareas.current.delete(item.id) }} rows={1} value={item.text} onKeyDown={(event) => onEditorKey(event, item)} onChange={(event) => updateBlock(item.id, { text: event.target.value })} /></div>
                  : item.type === 'attachment' ? <AttachmentPreview block={item} />
                    : <textarea ref={(node) => { if (node) textareas.current.set(item.id, node); else textareas.current.delete(item.id) }} rows={item.type === 'heading' ? 1 : Math.max(1, item.text.split('\n').length)} value={item.text} onKeyDown={(event) => onEditorKey(event, item)} onChange={(event) => updateBlock(item.id, { text: event.target.value })} placeholder={labels.typeCommand} />}
                {commands ? <div className="slash-menu" role="menu" aria-label={labels.blockType}>{(Object.keys(blockLabels) as Array<keyof typeof blockLabels>).map((type) => <button role="menuitem" key={type} onClick={() => updateBlock(item.id, { type, text: '' })}>{blockLabels[type]}</button>)}</div> : null}
                {links.length ? <div className="wiki-links">{links.map((title) => { const target = pages.find((candidate) => candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()); return target ? <button key={title} onClick={() => onOpenPage(target.id)}><Link2 size={13} />{title}</button> : <span key={title}><Link2 size={13} />{title}</span> })}</div> : null}
              </div>
              <button className="block-delete" onClick={() => deleteBlock(item.id)} aria-label={labels.deleteBlock}><Trash2 size={15} /></button>
            </div>
          )
        })}
      </div>
      {deleted ? <div className="undo-banner" role="status">{labels.deleteBlock}<button onClick={undoDelete}>{labels.undo}</button></div> : null}
      <div className="editor-add-row"><button onClick={() => addBlock()}><Plus size={15} />{labels.addBlock}</button><label><Paperclip size={15} />{labels.addAttachment}<input type="file" hidden accept="image/*,application/pdf,audio/*" onChange={(event) => void addAttachment(event.target.files?.[0])} /></label></div>
    </article>
  )
}
