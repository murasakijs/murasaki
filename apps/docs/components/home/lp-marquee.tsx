import type { CSSProperties } from "react";

/**
 * Infinite marquee band — the page's single saturated color field (the
 * madewithgsap-style accent banner): flat purple, black mono caps, hard cut
 * against the paper above and the near-black below. CSS-only (the track
 * holds two identical copies and loops -50%); paused under
 * prefers-reduced-motion. Server component — no client JS.
 */
export function LpMarquee({ phrases }: { phrases: string[] }) {
  const items = (copy: boolean) => (
    <span
      aria-hidden={copy || undefined}
      className="flex shrink-0 items-center"
    >
      {phrases.map((p) => (
        <span key={p} className="flex shrink-0 items-center">
          <span className="px-7">{p}</span>
          <span aria-hidden="true" className="text-[#111014]/60">
            ●
          </span>
        </span>
      ))}
    </span>
  );

  return (
    <div className="overflow-hidden bg-[#7c3aed] py-4">
      <div
        className="lp-marquee-track lp-mono flex w-max text-[12px] font-medium uppercase tracking-[0.28em] text-white"
        style={{ "--lp-marquee-duration": "42s" } as CSSProperties}
      >
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
