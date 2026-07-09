"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * The converging headline — the madewithgsap hero move, in Murasaki's
 * vocabulary: the viewport pins while "Native apps." slides in from the
 * left and "Web DX." from the right until they meet as one sentence, a
 * pixel square landing between them. Desktop pins for ~2 viewports;
 * mobile/reduced-motion get the finished line.
 */
export function PxConverge({ left, right }: { left: string; right: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const mm = gsap.matchMedia();
    mm.add(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: wrap,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.6,
            },
            defaults: { ease: "none" },
          });
          tl.from("[data-cv-left]", { xPercent: -85, duration: 0.6 }, 0)
            .from("[data-cv-right]", { xPercent: 85, duration: 0.6 }, 0)
            .from(
              "[data-cv-dot]",
              { scale: 0, opacity: 0, duration: 0.12, ease: "steps(3)" },
              0.55,
            )
            // Hold the finished line for a beat before the pin releases.
            .to({}, { duration: 0.3 });
        }, wrap);
        return () => ctx.revert();
      },
    );
    return () => mm.revert();
  }, []);

  return (
    <section className="bg-[#0e0e10] text-white">
      <div ref={wrapRef} className="relative lg:h-[220vh]">
        <div className="flex items-center justify-center overflow-hidden py-24 lg:sticky lg:top-0 lg:h-screen lg:py-0">
          <h2 className="lp-display flex flex-col items-center gap-3 px-6 text-center text-[clamp(2.4rem,7.5vw,7rem)] font-extrabold leading-[0.95] tracking-tight lg:flex-row lg:gap-[0.35em] lg:whitespace-nowrap">
            <span data-cv-left className="inline-block will-change-transform">
              {left}
            </span>
            <span
              data-cv-dot
              aria-hidden="true"
              className="hidden size-[0.14em] bg-[#7c3aed] lg:inline-block"
            />
            <span data-cv-right className="inline-block will-change-transform">
              {right}
            </span>
          </h2>
        </div>
      </div>
    </section>
  );
}
