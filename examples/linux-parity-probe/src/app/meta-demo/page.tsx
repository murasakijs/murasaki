import type { Metadata } from 'murasaki'

export const metadata: Metadata = { title: 'linux-parity-probe-metadata-ok' }

/** route-metadata probe: this page's static `metadata` export sets document.title. */
export default function MetaDemoPage() {
  return <div data-probe="META_PAGE_RENDERED" />
}
