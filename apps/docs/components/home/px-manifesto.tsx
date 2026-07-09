"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useMemo, useRef } from "react";

gsap.registerPlugin(ScrollTrigger);

/**
 * The manifesto as a pinned, full-viewport statement — the viewport holds
 * while the sentence lights up token by token under scrub, a Silkscreen
 * counter in the corner ticking the percentage (the madewithgsap
 * "ON SCREEN · 098" homage). English splits into words; Japanese (no
 * spaces) into characters, kanji igniting one by one. Desktop pins for
 * ~2.6 viewports; mobile keeps the un-pinned scrubbed illumination;
 * reduced-motion/no-JS read the sentence fully lit.
 */
export function PxManifesto({
  text,
  counterLabel,
}: {
  text: string;
  counterLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);

  const tokens = useMemo(() => {
    if (/\s/.test(text)) return text.split(/(?<=\s)/);
    return Array.from(text);
  }, [text]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const mm = gsap.matchMedia();

    const illuminate = (scrollTrigger: ScrollTrigger.Vars) => {
      gsap.fromTo(
        "[data-mn-token]",
        { opacity: 0.13 },
        { opacity: 1, ease: "none", stagger: 0.06, scrollTrigger },
      );
    };

    // Desktop: pin the statement and scrub the illumination through it.
    mm.add(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          illuminate({
            trigger: wrap,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.4,
            onUpdate: (self) => {
              if (counterRef.current) {
                counterRef.current.textContent = String(
                  Math.round(self.progress * 100),
                ).padStart(3, "0");
              }
            },
          });
        }, wrap);
        return () => ctx.revert();
      },
    );

    // Mobile: same illumination, no pin.
    mm.add(
      "(max-width: 1023px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          illuminate({
            trigger: wrap,
            start: "top 80%",
            end: "top 25%",
            scrub: 0.4,
          });
        }, wrap);
        return () => ctx.revert();
      },
    );

    return () => mm.revert();
  }, []);

  return (
    <section className="bg-[#0e0e10] text-white">
      <div ref={wrapRef} className="relative lg:h-[260vh]">
        <div className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:items-center">
          <div className="mx-auto w-full max-w-5xl px-6 py-28 lg:py-0">
            <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/45">
              <span className="text-[#a78bfa]">02</span> · Why it exists
            </p>
            <p className="lp-display mt-9 text-[clamp(1.7rem,4vw,3.4rem)] font-semibold leading-[1.25] tracking-tight">
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
            {/* The corner counter — only meaningful while pinned. */}
            <p
              aria-hidden="true"
              className="lp-pixel mt-14 hidden text-[11px] uppercase tracking-[0.3em] text-white/40 lg:block"
            >
              {counterLabel} · <span ref={counterRef}>000</span>
              <span className="text-[#a78bfa]">%</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
