"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * The converging headline — the madewithgsap hero move, in Murasaki's
 * vocabulary: the viewport pins while "Native apps." slides in from the
 * left and "Web DX." from the right until they meet as one sentence, a
 * purple `+` popping in between them (native + web). Desktop pins for
 * ~2 viewports; mobile/reduced-motion get the finished line.
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
          // Pin styling lives HERE, not in CSS: it only exists when this
          // animation actually runs (JS + desktop + motion allowed), so
          // no-JS/reduced-motion/mobile all get normal document flow.
          gsap.set(wrap, { height: "220vh" });
          // Pin below the fixed site header, not under it — measured live
          // so the scene's first line (the index label) stays visible.
          const navH = document.querySelector("header")?.offsetHeight ?? 56;
          gsap.set("[data-px-sticky]", {
            position: "sticky",
            top: navH,
            height: `calc(100vh - ${navH}px)`,
            paddingTop: 0,
            paddingBottom: 0,
          });
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
      <div ref={wrapRef} className="relative">
        <div
          data-px-sticky
          className="flex items-center justify-center overflow-hidden py-24"
        >
          <h2 className="lp-display flex flex-col items-center gap-3 px-6 text-center text-[clamp(2.4rem,7.5vw,7rem)] font-extrabold leading-[0.95] tracking-tight lg:flex-row lg:gap-[0.35em] lg:whitespace-nowrap">
            <span data-cv-left className="inline-block will-change-transform">
              {left}
            </span>
            <span
              data-cv-dot
              aria-hidden="true"
              className="hidden text-[0.6em] font-extrabold leading-none text-[#7c3aed] lg:inline-block"
            >
              +
            </span>
            <span data-cv-right className="inline-block will-change-transform">
              {right}
            </span>
          </h2>
        </div>
      </div>
    </section>
  );
}
