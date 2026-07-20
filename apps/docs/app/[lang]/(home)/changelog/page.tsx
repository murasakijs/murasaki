import type { Metadata } from "next";
import { ChangelogTimeline } from "@/components/home/px-changelog";
import { SiteFooter } from "@/components/home/site-footer";
import { getChangelog } from "@/lib/changelog";
import { homeContent } from "@/lib/home-content";
import { lpFontVariables } from "@/lib/lp-fonts";
import { localizedAlternates, localizedChangelogPath } from "@/lib/seo";

// The H1 stays the English product term "Changelog" in both locales (same
// convention as the rest of the site); only the framing copy below it
// localizes — the JA copy leads with 更新履歴 ("update history").
const COPY: Record<string, { intro: string }> = {
  en: {
    intro:
      "Every dated release of Murasaki — what shipped, what changed, and what to check before upgrading.",
  },
  ja: {
    intro:
      "更新履歴。Murasaki の各リリースで何が変わったか、アップグレード前に確認すべきことをまとめています。",
  },
};

export default async function ChangelogPage(
  props: PageProps<"/[lang]/changelog">,
) {
  const { lang } = await props.params;
  const t = homeContent[lang] ?? homeContent.en;
  const copy = COPY[lang] ?? COPY.en;
  const entries = getChangelog(lang === "ja" ? "ja" : "en");

  return (
    <div
      lang={lang}
      className={`${lpFontVariables} lp-sans flex flex-1 flex-col bg-[#f4f2ed]`}
    >
      <section className="bg-[#f4f2ed] pt-24 pb-4 text-[#111014] sm:pt-32">
        <div className="mx-auto w-full max-w-3xl px-6">
          <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
            Changelog
          </p>
          <h1 className="lp-display mt-6 text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight">
            Changelog
          </h1>
          <p className="lp-sans mt-5 max-w-2xl text-base leading-relaxed text-[#111014]/55 sm:text-lg">
            {copy.intro}
          </p>
        </div>
      </section>

      <ChangelogTimeline entries={entries} />

      <SiteFooter
        lang={lang}
        columns={t.footer.columns}
        community={t.footer.community}
        license={t.footer.license}
      />
    </div>
  );
}

export async function generateMetadata(
  props: PageProps<"/[lang]/changelog">,
): Promise<Metadata> {
  const { lang } = await props.params;
  const copy = COPY[lang] ?? COPY.en;
  const pagePath = localizedChangelogPath(lang);

  return {
    title: "Changelog",
    description: copy.intro,
    alternates: {
      canonical: pagePath,
      languages: localizedAlternates(localizedChangelogPath),
      types: {
        "application/rss+xml": "/changelog.xml",
      },
    },
    openGraph: {
      type: "website",
      locale: lang === "ja" ? "ja_JP" : "en_US",
      url: pagePath,
      title: "Changelog",
      description: copy.intro,
    },
  };
}
