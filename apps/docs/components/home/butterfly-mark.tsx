import { BUTTERFLY_VIEWBOX, butterflyRects } from "@/lib/butterfly-rects";

/**
 * The murasaki brand mark — a pixel-art/voxel butterfly, rendered from the
 * shared `butterflyRects` data (lib/butterfly-rects.ts), itself extracted
 * directly from the 16px-grid rects in `assets/logo.svg` (wordmark and
 * background dropped, coordinates normalized to a 17×12 unit grid). Same
 * three brand colors as the source logo: `#A855F7` (upper wings/body),
 * `#5B21B6` (lower wings), `#FAF5E8` (the two accent squares).
 *
 * `shapeRendering="crispEdges"` keeps the pixel edges sharp instead of
 * antialiased at large display sizes.
 */
export function ButterflyMark({ className }: { className?: string }) {
  return (
    <svg
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
