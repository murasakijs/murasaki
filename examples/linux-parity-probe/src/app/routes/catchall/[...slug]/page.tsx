import { useParams } from 'murasaki'

/** file-routing probe: a catch-all [...slug] segment. */
export default function CatchAllPage() {
  const { slug } = useParams()
  const ok = Array.isArray(slug) && slug.join('/') === 'a/b/c'
  return <div data-probe={ok ? 'CATCHALL_OK' : `CATCHALL_FAIL:${JSON.stringify(slug)}`} />
}
