"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef } from "react";
import { BUTTERFLY_VIEWBOX, butterflyRects } from "@/lib/butterfly-rects";

/**
 * Pixel primitives — the design language's atoms.
 *
 * `PixelButterfly`: the brand mark's 17×12 rect grid (lib/butterfly-rects.ts,
 * the same data the header logo and OG images use), GSAP-assembled pixel by
 * pixel from scatter on mount, then gently disassembled again by scroll
 * (each cell drifts on its own vector, scrubbed). Reduced motion renders it
 * whole and still — the rects are visible by default and only `gsap.from`
 * tweens move them, so no-JS/no-motion never hides the mark.
 *
 * `DitherDivider`: a two-color checkerboard seam between color fields —
 * the pixelated cut that replaces hard section edges.
 */
gsap.registerPlugin(ScrollTrigger);

export function PixelButterfly({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const cells = svg.querySelectorAll("rect");
      // Assemble: every pixel flies in from its own random offset.
      gsap.from(cells, {
        opacity: 0,
        x: () => gsap.utils.random(-140, 140, 2),
        y: () => gsap.utils.random(-120, 120, 2),
        duration: 1.1,
        ease: "power3.out",
        stagger: { each: 0.012, from: "random" },
        delay: 0.15,
      });
      // Disassemble on scroll: each pixel drifts apart, scrubbed.
      gsap.to(cells, {
        x: () => gsap.utils.random(-90, 90, 2),
        y: () => gsap.utils.random(-140, -30, 2),
        opacity: 0.15,
        ease: "none",
        stagger: { each: 0.004, from: "random" },
        scrollTrigger: {
          trigger: svg,
          start: "top 20%",
          end: "top -60%",
          scrub: 0.6,
        },
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox={BUTTERFLY_VIEWBOX}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {butterflyRects.map(([x, y, fill]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  );
}

export function DitherDivider({
  from,
  to,
  className,
}: {
  /** The field above the seam. */
  from: string;
  /** The field below the seam. */
  to: string;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={className} style={{ background: to }}>
      <div
        className="px-dither h-6 w-full"
        style={{ "--px-a": from, "--px-b": to } as CSSProperties}
      />
    </div>
  );
}
