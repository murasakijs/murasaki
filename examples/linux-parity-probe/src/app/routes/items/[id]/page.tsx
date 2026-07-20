import { useParams } from 'murasaki'

/** file-routing probe: a dynamic [id] segment. */
export default function ItemPage() {
  const { id } = useParams()
  const ok = id === '42'
  return <div data-probe={ok ? 'DYNAMIC_OK' : `DYNAMIC_FAIL:${String(id)}`}>{String(id)}</div>
}
