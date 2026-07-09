import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, ResolvingMetadata } from "next";
import { homeContent } from "@/lib/home-content";
import { i18n } from "@/lib/i18n";

export default async function Layout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;

  return <RootProvider i18n={i18n.provider(lang)}>{children}</RootProvider>;
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

function localizedHome(lang: string) {
  return lang === i18n.defaultLanguage ? "/" : `/${lang}`;
}

// Locale-appropriate title/description (copy reused from lib/home-content.ts
// so it stays consistent with the home page's own headline/subhead), plus
// hreflang alternates and an `openGraph.locale`. Nested route segments (docs
// pages, the home page) don't declare their own `alternates`, so this stays
// the effective canonical/hreflang for everything under `/${lang}` unless a
// segment overrides it — docs sub-pages don't yet set a page-specific
// canonical, which would be a reasonable follow-up.
export async function generateMetadata(
  { params }: LayoutProps<"/[lang]">,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { lang } = await params;
  const t = homeContent[lang] ?? homeContent.en;
  const parentOpenGraph = (await parent).openGraph ?? {};

  // Brand-first on the landing ("Murasaki | tagline") — the default title is
  // used as-is (not templated), while child pages (docs) resolve through the
  // template as "Quick start | Murasaki".
  const pageTitle =
    lang === "ja"
      ? "Murasaki | デスクトップアプリのための Next.js DX"
      : "Murasaki | Next.js DX for desktop apps";
  const socialTitle = pageTitle;

  return {
    // An object (not a plain string) re-declares the "%s · Murasaki"
    // template for this segment's own resolved title *and* keeps it
    // propagating to descendants (docs pages) — Next.js only carries a
    // title template one level deep from a plain string title, so without
    // this, `app/[lang]/docs/[[...slug]]/page.tsx`'s own `title: page.data.title`
    // would render bare ("Quick start") instead of templated
    // ("Quick start · Murasaki").
    // `absolute` (not `default`): the landing's brand-first title must NOT be
    // re-run through the ROOT layout's "%s | Murasaki" template (which would
    // double the brand). `template` still applies to child docs pages.
    title: { absolute: pageTitle, template: "%s | Murasaki" },
    description: t.subhead,
    alternates: {
      // The default language ("en") has no URL prefix (see lib/i18n.ts's
      // `hideLocale: "default-locale"`), so its home page is `/`, not `/en`.
      canonical: localizedHome(lang),
      languages: {
        ...Object.fromEntries(i18n.languages.map((l) => [l, localizedHome(l)])),
        "x-default": localizedHome(i18n.defaultLanguage),
      },
    },
    openGraph: {
      // Re-spread the parent (root layout)'s already-resolved openGraph —
      // including `siteName`/`type`/the static `opengraph-image.tsx` output
      // it picked up — since declaring `openGraph` here at all replaces the
      // whole object rather than deep-merging with the parent segment.
      ...parentOpenGraph,
      locale: lang === "ja" ? "ja_JP" : "en_US",
      title: socialTitle,
      description: t.subhead,
    },
  };
}
