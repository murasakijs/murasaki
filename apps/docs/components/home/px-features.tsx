"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { HomeContent } from "@/lib/home-content";

/**
 * Feature index — a contents page on paper: pixel index numbers, big ink
 * titles, gray descriptions, hairline rules. Rows rise in on scroll
 * (`gsap.from`, so no-JS/reduced-motion show the finished list).
 */
export function PxFeatures({
  eyebrow,
  heading,
  intro,
  features,
}: {
  eyebrow: string;
  heading: string;
  intro: string;
  features: HomeContent["features"];
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-ft-heading]", {
          yPercent: 110,
          duration: 0.8,
          ease: "expo.out",
          scrollTrigger: { trigger: root, start: "top 75%" },
        });
        for (const row of gsap.utils.toArray<HTMLElement>("[data-ft-row]")) {
          gsap.from(row, {
            opacity: 0,
            y: 26,
            duration: 0.65,
            ease: "power2.out",
            scrollTrigger: { trigger: row, start: "top 88%" },
          });
        }
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative bg-[#f4f2ed] py-24 text-[#111014] sm:py-32"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
          <span className="text-[#7c3aed]">03</span> · {eyebrow}
        </p>

        <div className="mt-6 overflow-hidden">
          <h2
            data-ft-heading
            className="lp-display max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
          >
            {heading}
          </h2>
        </div>

        <p className="lp-sans mt-5 max-w-2xl text-base leading-relaxed text-[#111014]/55 sm:text-lg">
          {intro}
        </p>

        <div className="mt-16 border-t border-[#111014]/15">
          {features.map((f, i) => (
            <div
              key={f.title}
              data-ft-row
              className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 border-b border-[#111014]/15 py-8 sm:grid-cols-[6rem_1fr_1.2fr] sm:gap-x-10 sm:py-10"
            >
              <span
                aria-hidden="true"
                className="lp-pixel self-start text-[11px] uppercase tracking-[0.25em] text-[#7c3aed]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="lp-display text-xl font-bold leading-tight sm:text-2xl lg:text-3xl">
                {f.title}
              </h3>
              <p className="lp-sans col-span-2 text-sm leading-relaxed text-[#111014]/55 sm:col-span-1 sm:text-base">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
