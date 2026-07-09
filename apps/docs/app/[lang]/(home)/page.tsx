import { codeToHtml } from "shiki";
import { LpMotion } from "@/components/home/lp-motion";
import { PxArtifacts } from "@/components/home/px-artifacts";
import { PxAscii } from "@/components/home/px-ascii";
import { PxConverge } from "@/components/home/px-converge";
import { PxCta } from "@/components/home/px-cta";
import { PxFeatures } from "@/components/home/px-features";
import { PxHero } from "@/components/home/px-hero";
import { PxManifesto } from "@/components/home/px-manifesto";
import { PxMarquee } from "@/components/home/px-marquee";
import { DitherDivider } from "@/components/home/px-pixel";
import { PxPlayground } from "@/components/home/px-playground";
import { PxScroll } from "@/components/home/px-scroll";
import { PxShowcase } from "@/components/home/px-showcase";
import { PxVersus } from "@/components/home/px-versus";
import { SiteFooter } from "@/components/home/site-footer";
import { JsonLd } from "@/components/json-ld";
import { appMenuSample } from "@/lib/code-samples";
import { homeContent, lpExtra } from "@/lib/home-content";
import { lpFontVariables } from "@/lib/lp-fonts";
import { absoluteUrl, localizedDocsPath, localizedHomePath } from "@/lib/seo";

const githubUrl = "https://github.com/murasakijs/murasaki";
const installCommand = "pnpm create murasaki@latest my-app";

const PAPER = "#f4f2ed";
const INKFIELD = "#0e0e10";
const PURPLE = "#7c3aed";

// The code panel is a deliberately fixed dark "device" card, independent of
// the docs site's own light/dark theme.
const CODE_THEME = "vesper";

/**
 * The landing page, v3 — the pixel edition. Design language: the
 * pixel-butterfly logo's 16px cell is the atomic unit (graph-paper texture,
 * checkerboard dither seams between color fields, Silkscreen micro-labels,
 * a GSAP-assembled pixel butterfly, a Matter.js pixel rain finale), set in
 * an editorial paper/ink system with purple as the single accent.
 *
 * Scroll stack: Lenis (inertia) + GSAP ScrollTrigger (choreography, incl.
 * the pinned native-proof scene) + framer-motion (menu micro-interactions)
 * + Matter.js (physics finale). Server component: content + Shiki happen at
 * build time; animation lives in `"use client"` leaves. The `lp-*`/`px-*`
 * styles and fonts are scoped to this subtree — docs stay untouched.
 */
export default async function HomePage(props: PageProps<"/[lang]">) {
  const { lang } = await props.params;
  const t = homeContent[lang] ?? homeContent.en;
  const x = lpExtra[lang] ?? lpExtra.en;

  const appMenuHtml = await codeToHtml(appMenuSample.code, {
    lang: appMenuSample.lang,
    theme: CODE_THEME,
  });

  const getStartedHref = localizedDocsPath(lang, [
    "getting-started",
    "quick-start",
  ]);
  const pageUrl = absoluteUrl(localizedHomePath(lang));
  const creatorId = `${absoluteUrl("/")}#creator`;
  const websiteId = `${absoluteUrl("/")}#website`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": creatorId,
        name: "ichi",
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: "Murasaki",
        url: absoluteUrl("/"),
        creator: { "@id": creatorId },
        inLanguage: ["en", "ja"],
      },
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        name:
          lang === "ja"
            ? "Murasaki — デスクトップアプリのための Next.js DX"
            : "Murasaki — Next.js DX for desktop apps",
        description: t.subhead,
        url: pageUrl,
        inLanguage: lang,
        isPartOf: { "@id": websiteId },
        about: { "@id": `${absoluteUrl("/")}#software` },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${absoluteUrl("/")}#software`,
        name: "Murasaki",
        description: t.subhead,
        url: absoluteUrl("/"),
        codeRepository: githubUrl,
        license: `${githubUrl}/blob/main/LICENSE`,
        programmingLanguage: ["TypeScript", "Rust"],
        runtimePlatform: ["macOS", "Windows", "Linux"],
        author: { "@id": creatorId },
        sameAs: [githubUrl, "https://x.com/murasaki_js"],
      },
    ],
  };

  return (
    <div
      lang={lang}
      className={`${lpFontVariables} lp-sans flex flex-1 flex-col bg-[#0e0e10]`}
    >
      <JsonLd data={structuredData} />
      <LpMotion>
        <PxScroll />

        <PxHero
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

        <DitherDivider from={PAPER} to={PURPLE} />
        <PxMarquee phrases={x.marquee} />
        <DitherDivider from={PURPLE} to={INKFIELD} />

        <PxConverge left={x.converge.left} right={x.converge.right} />

        <PxShowcase
          t={t.nativeDeepDive}
          demo={x.demo}
          codeHtml={appMenuHtml}
          codeLabel={t.nativeDeepDive.codeLabel}
        />

        <PxManifesto
          text={x.manifesto}
          counterLabel={x.manifestoCounterLabel}
        />

        <DitherDivider from={INKFIELD} to={PAPER} />

        <PxFeatures
          eyebrow={t.featuresEyebrow}
          heading={t.featuresHeading}
          intro={t.featuresIntro}
          features={t.features}
        />

        <PxPlayground {...x.playground} />

        <PxVersus
          t={t.whyMurasaki}
          rows={t.comparisonRows}
          footnote={t.comparisonFootnote}
        />

        <PxArtifacts
          heading={t.mockup.heading}
          caption={t.mockup.caption}
          platforms={t.distribution.platforms}
        />

        <DitherDivider from={PAPER} to={INKFIELD} />

        <PxAscii {...x.asciiButterfly} />

        <PxCta
          quickstart={t.quickStart}
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
