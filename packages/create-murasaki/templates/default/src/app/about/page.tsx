import { Link } from 'murasaki'

export default function AboutPage() {
  return (
    <main className="text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        About
      </h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">
        This page lives at <code className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-sm">src/app/about/page.tsx</code>.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-murasaki-bright hover:underline">
          ← Back home
        </Link>
      </p>
    </main>
  )
}
