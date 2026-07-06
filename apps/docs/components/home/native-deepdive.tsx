"use client";

import { motion, useReducedMotion } from "motion/react";

interface Bullet {
  title: string;
  description: string;
}

interface NativeDeepDiveProps {
  eyebrow: string;
  heading: string;
  paragraph: string;
  bullets: Bullet[];
  codeLabel: string;
  codeHtml: string;
  menuMockLabel: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// Matches CodeShowcase's CODE_CARD_BG — see components/home/code-showcase.tsx
// for why this is a fixed color independent of the docs site's own theme.
const CODE_CARD_BG = "#101010";

/**
 * "Not a browser tab. A real OS window." — the native window / menu bar /
 * context menu deep-dive, paired with a real `useContextMenu` snippet
 * (pulled verbatim from content/docs/guides/context-menu.mdx, highlighted
 * at build time the same way as the tabbed code showcase). The little
 * menu mock below the snippet is a decorative illustration only, labeled
 * as such via `menuMockLabel` — not a claim about its own rendering.
 */
export function NativeDeepDive({
  eyebrow,
  heading,
  paragraph,
  bullets,
  codeLabel,
  codeHtml,
  menuMockLabel,
}: NativeDeepDiveProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        className="motion-reveal mx-auto max-w-2xl text-center"
      >
        <span className="mb-5 inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 font-mono text-xs tracking-wide text-purple-700 uppercase dark:text-purple-300">
          {eyebrow}
        </span>
        <h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
          {heading}
        </h2>
        <p className="mt-4 text-balance text-muted-foreground">{paragraph}</p>
      </motion.div>

      <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-14">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
          className="motion-reveal flex flex-col gap-8"
        >
          {bullets.map((bullet) => (
            <div key={bullet.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-[2px] bg-purple-500"
              />
              <div>
                <h3 className="font-display text-lg font-bold tracking-tight sm:text-xl">
                  {bullet.title}
                </h3>
                <p className="mt-1.5 text-muted-foreground">
                  {bullet.description}
                </p>
              </div>
            </div>
          ))}

          {/* Decorative-only illustration of a native context menu — not a
              real, interactive menu. */}
          <div
            aria-hidden="true"
            className="mt-2 w-56 overflow-hidden rounded-lg border border-black/10 bg-white py-1.5 text-sm shadow-xl shadow-purple-950/10 ring-1 ring-black/5"
          >
            <div className="flex items-center justify-between px-3 py-1.5 text-neutral-700">
              <span>Reload</span>
              <span className="text-xs text-neutral-400">⌘R</span>
            </div>
            <div className="my-1 h-px bg-neutral-200" />
            <div className="px-3 py-1.5 text-neutral-700">Copy</div>
          </div>
          <p className="-mt-4 font-mono text-xs text-muted-foreground">
            {menuMockLabel}
          </p>
        </motion.div>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: EASE_OUT_EXPO, delay: 0.1 }}
          className="motion-reveal relative"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-4 -z-10 rounded-[2rem] bg-purple-500/10 blur-[70px] dark:bg-purple-500/20"
          />
          <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-purple-950/20">
            <div
              className="flex items-center border-b border-white/10 px-4 py-2.5 font-mono text-xs text-neutral-400"
              style={{ backgroundColor: CODE_CARD_BG }}
            >
              {codeLabel}
            </div>
            <div
              className="overflow-auto [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:p-5 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed"
              style={{ backgroundColor: CODE_CARD_BG }}
              // Build-time Shiki output for a verbatim docs snippet
              // (lib/code-samples.ts) — not user input.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, build-time HTML.
              dangerouslySetInnerHTML={{ __html: codeHtml }}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
