import { codeToHtml } from "shiki";
import { CodeShowcase } from "@/components/home/code-showcase";
import { CtaBand } from "@/components/home/cta-band";
import { Distribution } from "@/components/home/distribution";
import { Hero } from "@/components/home/hero";
import { NativeDeepDive } from "@/components/home/native-deepdive";
import { NumberedFeatures } from "@/components/home/numbered-features";
import { QuickStart } from "@/components/home/quick-start";
import { ShipArtifacts } from "@/components/home/ship-artifacts";
import { SiteFooter } from "@/components/home/site-footer";
import { WhyMurasaki } from "@/components/home/why-murasaki";
import { Wordmark } from "@/components/home/wordmark";
import { codeSamples, contextMenuSample } from "@/lib/code-samples";
import { homeContent } from "@/lib/home-content";

const githubUrl = "https://github.com/murasakijs/murasaki";
const installCommand = "pnpm create murasaki@latest my-app";

// Matches CODE_CARD_BG in components/home/code-showcase.tsx — the code
// panel is a deliberately fixed dark "device" card, independent of the
// docs site's own light/dark theme.
const CODE_THEME = "vesper";

export default async function HomePage(props: PageProps<"/[lang]">) {
  const { lang } = await props.params;
  const t = homeContent[lang] ?? homeContent.en;

  const highlighted = await Promise.all(
    codeSamples.map(
      async (sample) =>
        [
          sample.id,
          await codeToHtml(sample.code, {
            lang: sample.lang,
            theme: CODE_THEME,
          }),
        ] as const,
    ),
  );
  const htmlById = new Map(highlighted);
  const codeTabs = t.codeShowcase.tabs.map((tab, i) => ({
    ...tab,
    html: htmlById.get(codeSamples[i].id) ?? "",
  }));

  const contextMenuHtml = await codeToHtml(contextMenuSample.code, {
    lang: contextMenuSample.lang,
    theme: CODE_THEME,
  });

  return (
    <div className="flex flex-1 flex-col" lang={lang}>
      <Hero
        lang={lang}
        eyebrow={t.eyebrow}
        headline={t.headline}
        subhead={t.subhead}
        getStartedLabel={t.getStarted}
        getStartedHref={`/${lang}/docs/getting-started/quick-start`}
        githubLabel={t.github}
        githubHref={githubUrl}
        installCommand={installCommand}
      />

      {/* A full-bleed, solid-purple/white band — the site's boldest "color
          field" moment, deliberately not theme-reactive. */}
      <div className="bg-purple-600 py-3 text-white">
        <p className="px-6 text-center font-mono text-xs tracking-wide uppercase sm:text-sm">
          {t.bandLabel}
        </p>
      </div>

      <ShipArtifacts
        heading={t.mockup.heading}
        caption={t.mockup.caption}
        availableLabel={t.mockup.availableLabel}
        soonLabel={t.mockup.soonLabel}
      />

      <CodeShowcase
        eyebrow={t.codeShowcase.eyebrow}
        heading={t.codeShowcase.heading}
        description={t.codeShowcase.description}
        tabs={codeTabs}
      />

      <NumberedFeatures
        eyebrow={t.featuresEyebrow}
        heading={t.featuresHeading}
        description={t.featuresIntro}
        features={t.features}
      />

      <WhyMurasaki
        eyebrow={t.whyMurasaki.eyebrow}
        heading={t.whyMurasaki.heading}
        paragraph={t.whyMurasaki.paragraph}
        tableHeadings={t.whyMurasaki.tableHeadings}
        rows={t.comparisonRows}
        statValue={t.whyMurasaki.statValue}
        statLabel={t.whyMurasaki.statLabel}
        footnote={t.comparisonFootnote}
      />

      <NativeDeepDive
        eyebrow={t.nativeDeepDive.eyebrow}
        heading={t.nativeDeepDive.heading}
        paragraph={t.nativeDeepDive.paragraph}
        bullets={t.nativeDeepDive.bullets}
        codeLabel={t.nativeDeepDive.codeLabel}
        codeHtml={contextMenuHtml}
        menuMockLabel={t.nativeDeepDive.menuMockLabel}
      />

      <Distribution
        eyebrow={t.distribution.eyebrow}
        heading={t.distribution.heading}
        paragraph={t.distribution.paragraph}
        steps={t.distribution.steps}
        platforms={t.distribution.platforms}
      />

      <QuickStart
        eyebrow={t.quickStart.eyebrow}
        heading={t.quickStart.heading}
        steps={t.quickStart.steps}
      />

      <CtaBand
        heading={t.ctaBand.heading}
        paragraph={t.ctaBand.paragraph}
        installCommand={installCommand}
        getStartedLabel={t.getStarted}
        getStartedHref={`/${lang}/docs/getting-started/quick-start`}
      />

      <Wordmark />

      <SiteFooter
        lang={lang}
        columns={t.footer.columns}
        community={t.footer.community}
        license={t.footer.license}
      />
    </div>
  );
}
