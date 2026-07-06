"use client";

import { Plus, Zap } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

interface WindowMockupProps {
  heading: string;
  caption: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * The "what you actually build" section: a large, realistic native-window
 * mock (traffic lights, titlebar, a small rendered app UI). The window's
 * inner content is deliberately fixed-English and always light-chrome — it
 * echoes the REAL default scaffold (packages/create-murasaki/templates/
 * default/src/app/page.tsx: "Hello, Murasaki", the "Try it out" card, the
 * counter/API-route buttons), which ships English UI regardless of docs
 * locale, so it stays accurate for both `en` and `ja` readers.
 */
export function WindowMockup({ heading, caption }: WindowMockupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], [28, -28]);

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
      <motion.h2
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
        className="motion-reveal font-display text-balance text-center text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
      >
        {heading}
      </motion.h2>

      <motion.div
        ref={ref}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.7, ease: EASE_OUT_EXPO }}
        className="motion-reveal relative mt-14"
      >
        {/* Purple glow behind the window. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-8 -z-10 rounded-[3rem] bg-purple-500/20 blur-[90px] dark:bg-purple-500/30"
        />

        <motion.div
          style={{ y: prefersReducedMotion ? 0 : parallaxY }}
          className="mx-auto max-w-3xl"
        >
          {/* Decorative mock only — not real, interactive UI. */}
          <div
            aria-hidden="true"
            className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl shadow-purple-950/20 ring-1 ring-black/5"
          >
            {/* Titlebar */}
            <div className="relative flex items-center gap-1.5 border-b border-black/5 bg-neutral-100 px-4 py-2.5">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="absolute inset-x-0 text-center text-xs font-medium text-neutral-500">
                Murasaki App
              </span>
            </div>

            {/* App content */}
            <div className="relative bg-white px-8 py-16 text-center">
              <div className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-3 text-xs text-neutral-400">
                <span className="font-medium tracking-tight">murasaki</span>
                <span className="text-neutral-300">Web (coming soon)</span>
              </div>
              <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">
                Hello, Murasaki <span>🦋</span>
              </h3>
              <p className="mt-2 text-sm text-neutral-500">
                Right-click the card for its own menu.
              </p>

              <div className="mx-auto mt-7 max-w-xs rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-left shadow-sm">
                <p className="text-sm font-medium text-neutral-900">
                  Try it out
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Right-click this card, or edit{" "}
                  <code className="rounded bg-neutral-200 px-1 py-0.5 text-neutral-700">
                    src/app/page.tsx
                  </code>
                  .
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white">
                    <Plus className="size-3.5" /> Clicked 3 times
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700">
                    <Zap className="size-3.5" /> Call API route
                  </span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <p className="mt-8 text-center font-mono text-xs tracking-wide text-muted-foreground uppercase">
        {caption}
      </p>
    </section>
  );
}
