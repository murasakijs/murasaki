"use client";

import {
  type MotionValue,
  m,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useMemo, useRef } from "react";
import { SceneLabel } from "./lp-motion";

/**
 * The manifesto — the product's one-sentence "why", illuminated token by
 * token as it crosses the viewport (opacity keyed to scroll progress).
 * English splits into words; Japanese (no spaces) splits into characters,
 * which reads even better — kanji lighting up one by one. Reduced-motion and
 * no-JS render it fully lit (`.motion-reveal` + static opacity fallback).
 */

function Token({
  children,
  progress,
  range,
}: {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
}) {
  const opacity = useTransform(progress, range, [0.13, 1]);
  return (
    <m.span style={{ opacity }} className="motion-reveal">
      {children}
    </m.span>
  );
}

export function LpManifesto({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.45"],
  });

  const tokens = useMemo(() => {
    // Space-separated → words (keep the trailing space inside the token so
    // wrapping stays natural); otherwise (ja) → characters.
    if (/\s/.test(text)) return text.split(/(?<=\s)/);
    return Array.from(text);
  }, [text]);

  return (
    <section className="relative bg-[#0e0e10] py-28 text-white sm:py-40">
      <div className="mx-auto w-full max-w-5xl px-6">
        <SceneLabel index="02" code="WHY IT EXISTS" />
        <p
          ref={ref}
          className="lp-display mt-10 text-[clamp(1.7rem,4vw,3.4rem)] font-semibold leading-[1.25] tracking-tight"
        >
          {reduce
            ? text
            : tokens.map((token, i) => (
                <Token
                  // biome-ignore lint/suspicious/noArrayIndexKey: static text, order never changes.
                  key={i}
                  progress={scrollYProgress}
                  range={[
                    (i / tokens.length) * 0.9,
                    (i / tokens.length) * 0.9 + 0.1,
                  ]}
                >
                  {token}
                </Token>
              ))}
        </p>
      </div>
    </section>
  );
}
