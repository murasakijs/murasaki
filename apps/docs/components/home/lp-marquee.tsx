import type { CSSProperties } from "react";

/**
 * Infinite marquee band — the editorial "masthead" strip of facts in tiny
 * tracked-out mono caps, right under the hero's giant type (extreme scale
 * contrast on purpose). CSS-only: the track holds two identical copies and
 * loops -50% (`lp-marquee-track` in global.css); paused under
 * prefers-reduced-motion. Server component — no client JS at all.
 */
export function LpMarquee({ phrases }: { phrases: string[] }) {
  const items = (copy: boolean) => (
    <span
      aria-hidden={copy || undefined}
      className="flex shrink-0 items-center"
    >
      {phrases.map((p) => (
        <span key={p} className="flex shrink-0 items-center">
          <span className="px-6">{p}</span>
          <span aria-hidden="true" className="text-purple-400">
            ◆
          </span>
        </span>
      ))}
    </span>
  );

  return (
    <div className="overflow-hidden border-y border-purple-300/15 bg-[#0e0b18] py-3.5">
      <div
        className="lp-marquee-track lp-mono flex w-max text-[11px] uppercase tracking-[0.28em] text-purple-200/80"
        style={{ "--lp-marquee-duration": "42s" } as CSSProperties}
      >
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
