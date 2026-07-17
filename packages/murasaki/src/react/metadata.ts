/**
 * Static metadata shape, patterned after Next.js.
 *
 * Route modules export either:
 *
 * ```ts
 * export const metadata: Metadata = { title: 'Home' }
 * ```
 *
 * or a generator:
 *
 * ```ts
 * export async function generateMetadata(): Promise<Metadata> { … }
 * ```
 */
export interface Metadata {
  title?: string
  description?: string
  icons?: {
    icon?: string
    shortcut?: string
    apple?: string
  }
  openGraph?: {
    title?: string
    description?: string
    images?: string[]
  }
  [key: string]: unknown
}

/** Context passed to a route's `generateMetadata()`. */
export interface GenerateMetadataContext {
  params: Record<string, string>
}

/** Shape of a route module's `generateMetadata` export. */
export type GenerateMetadata = (
  ctx: GenerateMetadataContext,
) => Metadata | Promise<Metadata>

const MANAGED_ATTR = 'data-murasaki-meta'

/**
 * Applies resolved route metadata to the document: the title, description
 * meta element, Open Graph tags, and favicon, in a Next.js-style shape.
 *
 * Safe to call on every navigation: tags murasaki previously added are
 * removed first, so re-applying (or applying metadata for the next route)
 * replaces cleanly instead of accumulating stale tags. `document.title` is
 * only touched when a title is actually resolved — it's never blanked out.
 *
 * No-op outside a DOM environment (SSR-safe).
 */
export function applyMetadata(meta: Metadata): void {
  if (typeof document === 'undefined') return

  for (const el of document.head.querySelectorAll(`[${MANAGED_ATTR}]`)) {
    el.remove()
  }

  if (typeof meta.title === 'string' && meta.title.length > 0) {
    document.title = meta.title
  }

  upsertMeta('name', 'description', meta.description)
  upsertMeta('property', 'og:title', meta.openGraph?.title ?? meta.title)
  upsertMeta('property', 'og:description', meta.openGraph?.description ?? meta.description)
  upsertMeta('property', 'og:image', meta.openGraph?.images?.[0])
  upsertLink('icon', meta.icons?.icon)
}

/** Find-or-create a `<meta name|property="key">` tag and set its content. */
function upsertMeta(attr: 'name' | 'property', key: string, content: string | undefined): void {
  if (!content) return
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
  el.setAttribute(MANAGED_ATTR, '')
}

/** Find-or-create a `<link rel="rel">` tag and set its href. */
function upsertLink(rel: string, href: string | undefined): void {
  if (!href) return
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
  el.setAttribute(MANAGED_ATTR, '')
}
