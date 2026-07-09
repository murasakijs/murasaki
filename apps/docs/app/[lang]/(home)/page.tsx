import { codeToHtml } from "shiki";
import { LpGrain } from "@/components/home/lp-backdrop";
import { LpButterfly } from "@/components/home/lp-butterfly";
import { LpCta } from "@/components/home/lp-cta";
import { LpFeatures } from "@/components/home/lp-features";
import { LpHero } from "@/components/home/lp-hero";
import { LpManifesto } from "@/components/home/lp-manifesto";
import { LpMarquee } from "@/components/home/lp-marquee";
import { LpMotion } from "@/components/home/lp-motion";
import { LpNativeDemo } from "@/components/home/lp-native-demo";
import { LpQuickstart } from "@/components/home/lp-quickstart";
import { LpShip } from "@/components/home/lp-ship";
import { LpVersus } from "@/components/home/lp-versus";
import { SiteFooter } from "@/components/home/site-footer";
import { appMenuSample } from "@/lib/code-samples";
import { homeContent, lpExtra } from "@/lib/home-content";
import { lpFontVariables } from "@/lib/lp-fonts";

const githubUrl = "https://github.com/murasakijs/murasaki";
const installCommand = "pnpm create murasaki@latest my-app";

// The code panels are deliberately fixed dark "device" cards, independent of
// the docs site's own light/dark theme — the whole landing is art-directed
// dark-first, with one cream contrast scene (LpShip).
const CODE_THEME = "vesper";

/**
 * The landing page — "紫 / Murasaki" bold-grotesque art direction. Server
 * component: content + Shiki highlighting happen at build time; every
 * animated piece is a small `"use client"` leaf under one LazyMotion
 * provider (components/home/lp-motion.tsx). The `lp-*` font variables are
 * scoped to this subtree so the docs' typography stays untouched.
 */
export default async function HomePage(props: PageProps<"/[lang]">) {
  const { lang } = await props.params;
  const t = homeContent[lang] ?? homeContent.en;
  const x = lpExtra[lang] ?? lpExtra.en;

  const appMenuHtml = await codeToHtml(appMenuSample.code, {
    lang: appMenuSample.lang,
    theme: CODE_THEME,
  });

  const getStartedHref = `/${lang}/docs/getting-started/quick-start`;

  return (
    <div
      lang={lang}
      className={`${lpFontVariables} lp-sans flex flex-1 flex-col bg-[#0b0a12]`}
    >
      <LpMotion>
        <LpGrain />
        <LpButterfly />

        <LpHero
          eyebrow={t.eyebrow}
          headline={t.headline}
          getStartedLabel={t.getStarted}
          getStartedHref={getStartedHref}
          githubLabel={t.github}
          githubHref={githubUrl}
          installCommand={installCommand}
          tategaki={x.tategaki}
          scrollCue={x.scrollCue}
        />

        <LpMarquee phrases={x.marquee} />

        <LpNativeDemo
          t={t.nativeDeepDive}
          demo={x.demo}
          codeHtml={appMenuHtml}
          codeLabel={t.nativeDeepDive.codeLabel}
        />

        <LpManifesto text={x.manifesto} />

        <LpFeatures
          eyebrow={t.featuresEyebrow}
          heading={t.featuresHeading}
          intro={t.featuresIntro}
          features={t.features}
        />

        <LpVersus
          t={t.whyMurasaki}
          rows={t.comparisonRows}
          footnote={t.comparisonFootnote}
        />

        <LpShip
          heading={t.mockup.heading}
          caption={t.mockup.caption}
          platforms={t.distribution.platforms}
        />

        <LpQuickstart
          eyebrow={t.quickStart.eyebrow}
          heading={t.quickStart.heading}
          steps={t.quickStart.steps}
        />

        <LpCta
          heading={t.ctaBand.heading}
          paragraph={t.ctaBand.paragraph}
          installCommand={installCommand}
          getStartedLabel={t.getStarted}
          getStartedHref={getStartedHref}
          githubLabel={t.github}
          githubHref={githubUrl}
        />
      </LpMotion>

      <SiteFooter
        lang={lang}
        columns={t.footer.columns}
        community={t.footer.community}
        license={t.footer.license}
      />
    </div>
  );
}
