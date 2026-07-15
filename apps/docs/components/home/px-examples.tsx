import {
  Apple,
  Code2,
  Download,
  ExternalLink,
  MonitorDown,
} from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import type { LpExtra } from "@/lib/home-content";
import localSignalImage from "../../../../examples/local-signal/design/implementation.png";
import focusImage from "../../../../examples/murasaki-focus/design/implementation.png";
import violetNotesImage from "../../../../examples/violet-notes/design/implementation.png";

const REPO_URL = "https://github.com/murasakijs/murasaki";
const DEMO_RELEASE_URL = `${REPO_URL}/releases/tag/v0.47.3`;
const DEMO_ASSET_ROOT = `${REPO_URL}/releases/download/v0.47.3`;
const SAMPLE_RELEASE_URL = `${REPO_URL}/releases/tag/samples-v0.47.2`;

const SAMPLE_META: {
  slug: string;
  image: StaticImageData;
  imagePosition?: string;
}[] = [
  { slug: "violet-notes", image: violetNotesImage },
  { slug: "murasaki-focus", image: focusImage },
  { slug: "local-signal", image: localSignalImage },
];

const DOWNLOADS = [
  {
    key: "macArm" as const,
    href: `${DEMO_ASSET_ROOT}/MurasakiDemo-0.47.3-darwin-arm64.dmg`,
    icon: Apple,
  },
  {
    key: "macIntel" as const,
    href: `${DEMO_ASSET_ROOT}/MurasakiDemo-0.47.3-darwin-x64.dmg`,
    icon: Apple,
  },
  {
    key: "windows" as const,
    href: `${DEMO_ASSET_ROOT}/MurasakiDemo-0.47.3-setup.exe`,
    icon: MonitorDown,
  },
];

/**
 * Runnable proof — immutable release downloads for the default scaffold,
 * followed by the three independent showcase products. Static image imports
 * let Next emit fingerprinted local assets without a runtime image service.
 */
export function PxExamples({ content }: { content: LpExtra["examples"] }) {
  return (
    <section className="relative overflow-hidden bg-[#7c3aed] py-24 text-white sm:py-32">
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute -right-[6vw] top-0 select-none text-[46vw] font-bold leading-none text-white/[0.055] sm:text-[30vw]"
      >
        動
      </span>

      <div className="relative mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/65">
          <span className="text-white">06</span> · {content.eyebrow}
        </p>

        <h2 className="lp-display mt-6 max-w-4xl text-[clamp(2.4rem,7vw,5.5rem)] font-extrabold leading-[0.92] tracking-tight">
          {content.heading}
        </h2>
        <p className="lp-sans mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
          {content.intro}
        </p>

        <div className="mt-14 border border-white/20 bg-[#0e0e10] p-6 shadow-[12px_12px_0_rgba(17,16,20,0.22)] sm:p-9 lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:p-12">
          <div>
            <p className="lp-pixel text-[10px] uppercase tracking-[0.22em] text-[#a78bfa]">
              {content.defaultDemo.label}
            </p>
            <h3 className="lp-display mt-4 max-w-xl text-3xl font-extrabold leading-[0.95] tracking-tight sm:text-4xl lg:text-5xl">
              {content.defaultDemo.heading}
            </h3>
            <p className="lp-sans mt-5 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              {content.defaultDemo.description}
            </p>
          </div>

          <div className="mt-8 border-t border-white/15 pt-8 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <div className="grid gap-3">
              {DOWNLOADS.map(({ key, href, icon: Icon }) => (
                <a
                  key={key}
                  href={href}
                  className="lp-sans group flex min-h-12 items-center justify-between gap-4 border border-white/25 px-4 py-3 text-sm font-bold transition-colors hover:border-[#a78bfa] hover:bg-[#7c3aed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span>{content.defaultDemo[key]}</span>
                  </span>
                  <Download
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-hover:translate-y-0.5"
                  />
                </a>
              ))}
            </div>

            <a
              href={DEMO_RELEASE_URL}
              className="lp-mono mt-5 inline-flex items-center gap-2 text-xs text-white/55 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
            >
              {content.defaultDemo.releaseNotes}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
            <p className="lp-mono mt-4 text-[11px] leading-relaxed text-white/40">
              {content.defaultDemo.firstLaunch}
            </p>
          </div>
        </div>

        <div className="mt-20 flex items-end justify-between gap-6 border-b border-white/25 pb-5">
          <h3 className="lp-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            {content.sampleLabel}
          </h3>
          <a
            href={SAMPLE_RELEASE_URL}
            className="lp-pixel hidden items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/65 transition-colors hover:text-white sm:flex"
          >
            {content.downloadsLabel}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </div>

        <div className="mt-8 grid gap-8 md:grid-cols-3">
          {SAMPLE_META.map((meta, index) => {
            const app = content.apps[index];
            if (!app) return null;
            return (
              <article key={meta.slug} className="min-w-0">
                <div className="relative aspect-[16/10] overflow-hidden border border-white/25 bg-[#111014]">
                  <Image
                    src={meta.image}
                    alt={`${app.name} desktop app`}
                    fill
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover transition-transform duration-500 hover:scale-[1.025]"
                  />
                </div>
                <h4 className="lp-display mt-5 text-2xl font-extrabold tracking-tight">
                  {app.name}
                </h4>
                <p className="lp-sans mt-3 text-sm leading-relaxed text-white/65">
                  {app.description}
                </p>
                <div className="lp-mono mt-5 flex flex-wrap gap-x-5 gap-y-3 text-xs">
                  <a
                    href={`${REPO_URL}/tree/main/examples/${meta.slug}`}
                    className="inline-flex items-center gap-2 text-white/65 transition-colors hover:text-white"
                  >
                    <Code2 aria-hidden="true" className="size-3.5" />
                    {content.sourceLabel}
                  </a>
                  <a
                    href={SAMPLE_RELEASE_URL}
                    className="inline-flex items-center gap-2 text-white/65 transition-colors hover:text-white"
                  >
                    <Download aria-hidden="true" className="size-3.5" />
                    {content.downloadsLabel}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
