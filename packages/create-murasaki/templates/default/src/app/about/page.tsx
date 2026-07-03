import { Link } from 'murasaki'
import type { Metadata } from 'murasaki'
import { Card, CardHeader, CardTitle, CardContent } from '@murasakijs/ui'

export const metadata: Metadata = {
  title: 'About · Murasaki App',
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-md text-center">
      <Card className="text-left">
        <CardHeader>
          <CardTitle className="text-center text-4xl">About</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-muted-foreground">
            This page lives at{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">src/app/about/page.tsx</code>.
          </p>
        </CardContent>
      </Card>
      <p className="mt-6">
        <Link href="/" className="text-murasaki-bright hover:underline">
          ← Back home
        </Link>
      </p>
    </main>
  )
}
