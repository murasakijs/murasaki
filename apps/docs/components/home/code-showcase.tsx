"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CodeTab {
  id: string;
  label: string;
  html: string;
}

interface CodeShowcaseProps {
  eyebrow: string;
  heading: { prefix: string; highlight: string; suffix: string };
  description: string;
  tabs: CodeTab[];
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// Matches the "vesper" Shiki theme's own background — see page.tsx — so the
// tab bar and the highlighted code read as one continuous dark "device"
// card, independent of the docs site's own light/dark theme.
const CODE_CARD_BG = "#101010";

export function CodeShowcase({
  eyebrow,
  heading,
  description,
  tabs,
}: CodeShowcaseProps) {
  const [activeId, setActiveId] = useState(tabs[0]?.id);
  const prefersReducedMotion = useReducedMotion();
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

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
          {heading.prefix}
          <span className="bg-gradient-to-r from-purple-600 to-purple-500 bg-clip-text text-transparent dark:from-purple-400 dark:to-purple-300">
            {heading.highlight}
          </span>
          {heading.suffix}
        </h2>
        <p className="mt-4 text-balance text-muted-foreground">{description}</p>
      </motion.div>

      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO, delay: 0.1 }}
        className="motion-reveal relative mt-12"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-8 -z-10 rounded-[2.5rem] bg-purple-500/10 blur-[80px] dark:bg-purple-500/20"
        />
        <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-purple-950/20">
          {/* Tab bar */}
          <div
            role="tablist"
            aria-label="Code sample"
            className="flex items-center gap-1 overflow-x-auto border-b border-white/10 px-2 py-2"
            style={{ backgroundColor: CODE_CARD_BG }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 font-mono text-xs whitespace-nowrap transition-colors",
                  tab.id === activeTab?.id
                    ? "bg-purple-600 text-white"
                    : "text-neutral-400 hover:text-neutral-200",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Code panel */}
          <div
            className="max-h-[26rem] overflow-auto [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:p-5 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed"
            style={{ backgroundColor: CODE_CARD_BG }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab?.id}
                role="tabpanel"
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="motion-reveal"
                // Build-time Shiki output for our own verbatim code samples
                // (lib/code-samples.ts) — not user input.
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, build-time HTML.
                dangerouslySetInnerHTML={{ __html: activeTab?.html ?? "" }}
              />
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
