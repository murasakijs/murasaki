import { OrgliaApp } from '@/components/OrgliaApp'
import { OrgliaProvider } from '@/state/OrgliaStore'

export default function Page() {
  return (
    <OrgliaProvider>
      <OrgliaApp />
    </OrgliaProvider>
  )
}
