"use client";

import { domAnimation, LazyMotion, MotionConfig, m } from "motion/react";
import type { ReactNode } from "react";

/**
 * Shared motion foundation for the landing page.
 *
 * One `LazyMotion` at the LP root keeps the initial bundle small (every LP
 * component uses `m.*`, never `motion.*` — `strict` enforces it), and
 * `reducedMotion="user"` strips transform-based animation for
 * `prefers-reduced-motion` while keeping opacity/color fades. Scroll-driven
 * MotionValues aren't covered by that config, so components driving them
 * (butterfly flight, mesh drift, word illumination) additionally check
 * `useReducedMotion()` themselves. The `.motion-reveal` class each reveal
 * carries is the CSS/no-JS fallback — see global.css.
 */
export function LpMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Signature ease — fast out, long settle (easeOutExpo-ish). */
export const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Spec-sheet scene label — the tiny tracked-out mono chrome that opens every
 * section ("01 / NATIVE PROOF"). A deliberate extreme-scale contrast against
 * the huge display headlines: nothing sits between these two sizes.
 */
export function SceneLabel({
  index,
  code,
  tone = "dark",
}: {
  index: string;
  code: string;
  /** "dark" sections get purple-on-dark chrome, "light" the inverse. */
  tone?: "dark" | "light";
}) {
  return (
    <m.p
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={`motion-reveal lp-mono flex items-center gap-3 text-[11px] tracking-[0.3em] uppercase ${
        tone === "dark" ? "text-purple-300/70" : "text-purple-700/70"
      }`}
    >
      <span aria-hidden="true">{index}</span>
      <span
        aria-hidden="true"
        className={`h-px w-10 ${tone === "dark" ? "bg-purple-300/40" : "bg-purple-700/40"}`}
      />
      <span>{code}</span>
    </m.p>
  );
}

/**
 * Mask reveal: text slides up from behind an `overflow:hidden` clip — the
 * line-reveal used across award-tier type sites. Cheaper and more reliable
 * than animating clip-path.
 *
 * The `whileInView` trigger lives on the OUTER (unclipped) element and the
 * inner span animates via variant propagation: an IntersectionObserver on
 * the inner span would see it fully clipped by the overflow-hidden parent
 * (intersection ratio 0) and never fire.
 */
const MASK_TAGS = {
  div: m.div,
  span: m.span,
  p: m.p,
  h2: m.h2,
  h3: m.h3,
} as const;

export function MaskReveal({
  children,
  delay = 0,
  as = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  as?: keyof typeof MASK_TAGS;
  className?: string;
}) {
  const MTag = MASK_TAGS[as];
  return (
    <MTag
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.5 }}
      className={`overflow-hidden ${className ?? ""}`}
    >
      <m.span
        variants={{
          hidden: { y: "110%" },
          visible: {
            y: "0%",
            transition: { duration: 0.8, ease: EASE, delay },
          },
        }}
        className="motion-reveal block will-change-transform"
      >
        {children}
      </m.span>
    </MTag>
  );
}
