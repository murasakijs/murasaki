import {
  AppWindow,
  Palette,
  Route,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const githubUrl = "https://github.com/murasakijs/murasaki";
const npmUrl = "https://www.npmjs.com/package/murasaki";

const comparisonRows = [
  {
    label: "UI runtime",
    murasaki: "OS WebView (wry)",
    electron: "Bundled Chromium",
    tauri: "OS WebView",
  },
  {
    label: "Language",
    murasaki: "TypeScript / React",
    electron: "TypeScript / React",
    tauri: "TypeScript + Rust",
  },
  {
    label: "DX",
    murasaki: "Next.js-style (Vite HMR)",
    electron: "Manual wiring",
    tauri: "Manual wiring",
  },
  {
    label: "Memory (idle)",
    murasaki: "~1/5 of Electron*",
    electron: "Baseline",
    tauri: "Small",
  },
  {
    label: "Server actions",
    murasaki: "defineAction / useAction",
    electron: "Manual IPC",
    tauri: "Manual IPC / commands",
  },
];

const features = [
  {
    title: "File-based routing",
    description:
      "src/app/**/page.tsx, layouts, and dynamic segments — the routing you already know from Next.js.",
    href: "/docs/guides/routing",
    icon: Route,
  },
  {
    title: "Server Actions",
    description:
      "'use server' + defineAction / useAction — the same React 19 shape, running natively.",
    href: "/docs/guides/server-actions",
    icon: Zap,
  },
  {
    title: "API Routes",
    description:
      "Next.js-style src/api/**/route.ts HTTP endpoints, no extra server to run.",
    href: "/docs/guides/api-routes",
    icon: Server,
  },
  {
    title: "Native window & menus",
    description:
      "A real native window, a native menu bar, and scoped native context menus — not HTML popups.",
    href: "/docs/guides/native-apis",
    icon: AppWindow,
  },
  {
    title: "UI kit",
    description:
      "@murasakijs/ui — a shadcn-style component library built for murasaki apps.",
    href: "/docs/guides/styling",
    icon: Palette,
  },
  {
    title: "Signed distribution",
    description:
      "Portable .app bundles with optional code signing and notarization.",
    href: "/docs/building/distribution",
    icon: ShieldCheck,
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-32 -z-10 flex justify-center"
        >
          <div className="h-72 w-[36rem] rounded-full bg-purple-500/25 blur-3xl dark:bg-purple-500/15" />
        </div>
        <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center sm:py-32">
          <span className="mb-4 inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-700 dark:text-purple-300">
            React 19 · Vite · Rust-native
          </span>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-6xl">
            Next.js DX for desktop apps.
          </h1>
          <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
            Build native desktop apps with file-based routing, server actions,
            and React 19 — in a Rust-native window, not Electron's Chromium.
            Without writing Rust.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/getting-started/quick-start"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-purple-600 text-white hover:bg-purple-500",
              )}
            >
              Get started
            </Link>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              GitHub
            </a>
          </div>
          <div className="mt-10">
            <CopyCommand command="pnpm create murasaki@latest my-app" />
          </div>
        </div>
      </section>

      {/* Why murasaki */}
      <section className="mx-auto w-full max-w-4xl px-6 py-16 sm:py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Why murasaki
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Choose murasaki if you know React/Next.js and want a small-footprint
          desktop app without learning Rust or hand-wiring IPC.
        </p>
        <div className="mt-10 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="px-4 py-3 font-medium text-muted-foreground"
                >
                  <span className="sr-only">Category</span>
                </th>
                <th
                  scope="col"
                  className="bg-purple-500/5 px-4 py-3 font-semibold text-purple-700 dark:text-purple-300"
                >
                  murasaki
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 font-medium text-muted-foreground"
                >
                  Electron
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 font-medium text-muted-foreground"
                >
                  Tauri
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-border last:border-0"
                >
                  <th
                    scope="row"
                    className="px-4 py-3 font-medium text-foreground"
                  >
                    {row.label}
                  </th>
                  <td className="bg-purple-500/5 px-4 py-3 font-medium text-purple-700 dark:text-purple-300">
                    {row.murasaki}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.electron}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.tauri}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          * commonly-cited ballpark for Electron/Tauri — not a measured
          benchmark.
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Everything you need to ship a desktop app
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Link
              key={feature.title}
              href={feature.href}
              className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Card className="h-full transition-colors group-hover:ring-purple-500/40">
                <CardHeader>
                  <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <feature.icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle>
                    <h3 className="contents">{feature.title}</h3>
                  </CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <span aria-hidden="true">🦋</span>
            murasaki
          </div>
          <nav aria-label="Footer" className="flex items-center gap-6">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href={npmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              npm
            </a>
          </nav>
          <p>MIT licensed</p>
        </div>
      </footer>
    </div>
  );
}
