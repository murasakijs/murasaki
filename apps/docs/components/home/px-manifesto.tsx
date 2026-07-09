"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useMemo, useRef } from "react";

/**
 * The manifesto — the one-sentence "why", illuminated token by token with a
 * GSAP scrubbed stagger as it crosses the viewport. English splits into
 * words; Japanese (no spaces) splits into characters — kanji lighting up
 * one by one. `fromTo` on opacity only, so reduced-motion / no-JS read the
 * sentence fully lit.
 */
export function PxManifesto({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  const tokens = useMemo(() => {
    if (/\s/.test(text)) return text.split(/(?<=\s)/);
    return Array.from(text);
  }, [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.fromTo(
          "[data-mn-token]",
          { opacity: 0.13 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.06,
            scrollTrigger: {
              trigger: el,
              start: "top 82%",
              end: "top 32%",
              scrub: 0.4,
            },
          },
        );
      }, el);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section className="bg-[#0e0e10] py-28 text-white sm:py-40">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/45">
          <span className="text-[#a78bfa]">02</span> · Why it exists
        </p>
        <p
          ref={ref}
          className="lp-display mt-9 text-[clamp(1.7rem,4vw,3.4rem)] font-semibold leading-[1.25] tracking-tight"
        >
          {tokens.map((token, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static text, order never changes.
              key={i}
              data-mn-token
            >
              {token}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
