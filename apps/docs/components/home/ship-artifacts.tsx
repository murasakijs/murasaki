"use client";

import { Terminal } from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";

interface ShipArtifactsProps {
  heading: string;
  caption: string;
  availableLabel: string;
  soonLabel: string;
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

interface Artifact {
  os: string;
  glyph: "apple" | "windows" | "linux";
  ext: string;
  note?: string;
  available: boolean;
}

// Real distributable files, not the running app: macOS is the only platform
// that ships an installer today (.dmg/.app, ~43 MB measured). Windows/Linux
// packaging is on the roadmap — kept honest here to match the `distribution`
// section's platform cards further down the page.
const ARTIFACTS: Artifact[] = [
  {
    os: "macOS",
    glyph: "apple",
    ext: ".dmg / .app",
    note: "~43 MB",
    available: true,
  },
  { os: "Windows", glyph: "windows", ext: ".msi / .exe", available: false },
  { os: "Linux", glyph: "linux", ext: ".AppImage", available: false },
];

function OsGlyph({ glyph }: { glyph: Artifact["glyph"] }) {
  if (glyph === "apple") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="size-7 fill-current"
        aria-hidden="true"
      >
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 8.02 7.36c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.5 4.03zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    );
  }
  if (glyph === "windows") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="size-6 fill-current"
        aria-hidden="true"
      >
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    );
  }
  // No clean single-color penguin glyph at this size reads well, so Linux
  // uses lucide's Terminal — recognizable as "OS/shell" and stays monochrome
  // like the other two glyphs.
  return <Terminal className="size-6" aria-hidden="true" />;
}

/**
 * The "what you actually ship" section: three installer-artifact cards for
 * the real files `pnpm bundle` / `murasaki installer` produce, replacing the
 * old fake running-app window mock. macOS is the star (available today);
 * Windows and Linux are dimmed "coming soon" cards — never implied as
 * shipping.
 */
export function ShipArtifacts({
  heading,
  caption,
  availableLabel,
  soonLabel,
}: ShipArtifactsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const parallaxY = useTransform(scrollYProgress, [0, 1], [20, -20]);

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
        {/* Purple glow behind the cards. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-8 -z-10 rounded-[3rem] bg-purple-500/20 blur-[90px] dark:bg-purple-500/30"
        />

        <motion.div
          style={{ y: prefersReducedMotion ? 0 : parallaxY }}
          className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3"
        >
          {ARTIFACTS.map((artifact) => (
            <div
              key={artifact.os}
              className={`flex flex-col items-center rounded-2xl border px-6 py-8 text-center ${
                artifact.available
                  ? "border-purple-500/40 bg-card shadow-lg shadow-purple-500/10"
                  : "border-border bg-card opacity-70"
              }`}
            >
              <span
                className={
                  artifact.available
                    ? "text-purple-500"
                    : "text-muted-foreground"
                }
              >
                <OsGlyph glyph={artifact.glyph} />
              </span>
              <p className="mt-5 font-mono text-2xl font-bold tracking-tight text-foreground">
                {artifact.ext}
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {artifact.os}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {artifact.note ?? " "}
              </p>
              <span
                className={`mt-5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.65rem] tracking-wide uppercase ${
                  artifact.available
                    ? "bg-purple-500/10 text-purple-700 dark:text-purple-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    artifact.available
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/50"
                  }`}
                />
                {artifact.available ? availableLabel : soonLabel}
              </span>
            </div>
          ))}
        </motion.div>

        <div className="mt-10 flex justify-center">
          <code className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-2.5 font-mono text-xs text-muted-foreground sm:text-sm">
            <span className="text-foreground">pnpm installer</span>
            <span aria-hidden="true">→</span>
            <span>dist/&lt;App&gt;-&lt;version&gt;.dmg</span>
          </code>
        </div>
      </motion.div>

      <p className="mt-8 text-center font-mono text-xs tracking-wide text-muted-foreground">
        {caption}
      </p>
    </section>
  );
}
