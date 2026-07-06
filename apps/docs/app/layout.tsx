import "./global.css";
import type { Metadata } from "next";
import { Geist, Inter } from "next/font/google";
import { fraunces, geistMono, notoSansJP, zenOldMincho } from "@/lib/fonts";
import { homeContent } from "@/lib/home-content";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const inter = Inter({
  subsets: ["latin"],
});

// `NEXT_PUBLIC_SITE_URL` lets the deployed origin change (GitHub Pages today,
// murasaki.dev on a VPS later) without a code edit — every relative URL in
// metadata (canonical, hreflang, og/twitter images) resolves against this.
// Falls back to the current live GitHub Pages URL, matching next.config.mjs's
// static-export target; not murasaki.dev yet since that domain isn't live.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://murasakijs.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "murasaki — Next.js DX for desktop apps",
    template: "%s · murasaki",
  },
  description: homeContent.en.subhead,
  applicationName: "murasaki",
  keywords: [
    "murasaki",
    "desktop apps",
    "React",
    "Next.js",
    "Rust",
    "Electron alternative",
    "Tauri alternative",
    "Vite",
    "TypeScript",
    "native window",
    "cross-platform",
  ],
  openGraph: {
    type: "website",
    siteName: "murasaki",
    // No `images` here — the static `app/opengraph-image.tsx` file
    // convention is auto-injected by Next.js's metadata resolver.
  },
  twitter: {
    card: "summary_large_image",
    site: "@murasaki_js",
    creator: "@murasaki_js",
    // No `images` here either — Next.js falls back to `openGraph.images`
    // when `twitter.images` isn't explicitly set (see app/[lang]/layout.tsx
    // for the per-locale generateMetadata that keeps this working there).
  },
};

// This is the TRUE root layout: it owns <html>/<body> and is shared by every
// route under app/[lang]/** (which nests its own RootProvider, see
// app/[lang]/layout.tsx) — including `/` itself, which the i18n middleware
// (proxy.ts) rewrites internally to `/en` (see lib/i18n.ts's
// `hideLocale: "default-locale"`) without a visible redirect. It has no i18n
// dependency, so `lang` is pinned to "en" here — the actual page content's
// language is set per-locale by the nested layout via
// <RootProvider i18n={...}>, but reflecting that back onto this <html lang>
// would need a client-side effect, which risks a hydration warning for
// little benefit while ja has no translated content yet.
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        inter.className,
        "font-sans",
        geist.variable,
        fraunces.variable,
        zenOldMincho.variable,
        geistMono.variable,
        notoSansJP.variable,
      )}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        {/* No-JS fallback for the landing page's motion reveals: forces every
            `.motion-reveal` element (components/home/*) back to fully visible
            — see the media-query counterpart in global.css for the
            reduced-motion case, and the `.motion-reveal` doc comment there
            for the full rationale. Browsers only apply a `<noscript>`'s
            contents when scripting is disabled, and parse them as raw text
            otherwise, so this is set via `dangerouslySetInnerHTML` rather
            than JSX children (which would render as literal text once JS
            *is* enabled). */}
        <noscript>
          <style
            // biome-ignore lint/security/noDangerouslySetInnerHtml: static, trusted CSS string, not user input.
            dangerouslySetInnerHTML={{
              __html:
                ".motion-reveal{opacity:1!important;transform:none!important}",
            }}
          />
        </noscript>
        {children}
      </body>
    </html>
  );
}
