"use client";

import { m, useReducedMotion } from "motion/react";

/**
 * Texture + color-field layers for the landing page.
 *
 * `LpGrain` — a fixed feTurbulence noise wash over the whole page (the thing
 * that keeps the purple fields from reading as a flat "template gradient").
 * `LpMesh` — a faked mesh gradient: a handful of huge, blurred radial blobs
 * drifting on long easeInOut loops. Transform/opacity only, so it's
 * GPU-composited despite running forever; reduced-motion freezes the drift.
 */

const NOISE_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function LpGrain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-20 opacity-[0.06] mix-blend-overlay"
      style={{ backgroundImage: NOISE_URI }}
    />
  );
}

interface Blob {
  color: string;
  size: string;
  left: string;
  top: string;
  opacity: number;
  duration: number;
  dx: string[];
  dy: string[];
}

const VARIANTS: Record<"hero" | "cta", Blob[]> = {
  hero: [
    {
      color: "#7c3aed",
      size: "48rem",
      left: "-14%",
      top: "-18%",
      opacity: 0.55,
      duration: 26,
      dx: ["0%", "12%", "-4%", "0%"],
      dy: ["0%", "10%", "16%", "0%"],
    },
    {
      color: "#d946ef",
      size: "38rem",
      left: "58%",
      top: "-10%",
      opacity: 0.32,
      duration: 32,
      dx: ["0%", "-10%", "6%", "0%"],
      dy: ["0%", "14%", "4%", "0%"],
    },
    {
      color: "#4c1d95",
      size: "52rem",
      left: "28%",
      top: "42%",
      opacity: 0.6,
      duration: 38,
      dx: ["0%", "8%", "-10%", "0%"],
      dy: ["0%", "-8%", "6%", "0%"],
    },
    {
      color: "#a855f7",
      size: "24rem",
      left: "8%",
      top: "52%",
      opacity: 0.35,
      duration: 22,
      dx: ["0%", "18%", "-8%", "0%"],
      dy: ["0%", "-12%", "10%", "0%"],
    },
  ],
  cta: [
    {
      color: "#7c3aed",
      size: "46rem",
      left: "8%",
      top: "-24%",
      opacity: 0.5,
      duration: 30,
      dx: ["0%", "10%", "-6%", "0%"],
      dy: ["0%", "12%", "4%", "0%"],
    },
    {
      color: "#d946ef",
      size: "34rem",
      left: "62%",
      top: "30%",
      opacity: 0.3,
      duration: 26,
      dx: ["0%", "-12%", "6%", "0%"],
      dy: ["0%", "-8%", "10%", "0%"],
    },
    {
      color: "#4c1d95",
      size: "44rem",
      left: "-12%",
      top: "44%",
      opacity: 0.55,
      duration: 34,
      dx: ["0%", "10%", "-8%", "0%"],
      dy: ["0%", "-10%", "6%", "0%"],
    },
  ],
};

export function LpMesh({ variant }: { variant: "hero" | "cta" }) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {VARIANTS[variant].map((b) => (
        <m.div
          key={`${b.color}-${b.left}-${b.top}`}
          className="absolute rounded-full mix-blend-screen blur-[110px] will-change-transform"
          style={{
            width: b.size,
            height: b.size,
            left: b.left,
            top: b.top,
            opacity: b.opacity,
            background: `radial-gradient(circle at 35% 35%, ${b.color}, transparent 70%)`,
          }}
          animate={
            reduce
              ? undefined
              : { x: b.dx, y: b.dy, scale: [1, 1.1, 0.96, 1] }
          }
          transition={{
            duration: b.duration,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
