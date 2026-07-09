import type { CSSProperties } from "react";

/**
 * The page's one saturated color field: a flat purple marquee band in pixel
 * type, seamed to its neighbors with checkerboard dithers (see
 * DitherDivider usage in page.tsx). CSS-only; paused under
 * prefers-reduced-motion. Server component.
 */
export function PxMarquee({ phrases }: { phrases: string[] }) {
  const items = (copy: boolean) => (
    <span
      aria-hidden={copy || undefined}
      className="flex shrink-0 items-center"
    >
      {phrases.map((p) => (
        <span key={p} className="flex shrink-0 items-center">
          <span className="px-7">{p}</span>
          <span aria-hidden="true" className="text-[#111014]/50">
            ▪
          </span>
        </span>
      ))}
    </span>
  );

  return (
    <div className="overflow-hidden bg-[#7c3aed] py-4">
      <div
        className="lp-marquee-track lp-pixel flex w-max text-[12px] uppercase tracking-[0.2em] text-white"
        style={{ "--lp-marquee-duration": "46s" } as CSSProperties}
      >
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
