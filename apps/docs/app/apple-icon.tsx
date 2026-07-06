import { ImageResponse } from "next/og";
import { BUTTERFLY_VIEWBOX, butterflyRects } from "@/lib/butterfly-rects";

// Apple touch icon: the brand butterfly on the brand dark field, `#0B0518`
// (matches assets/logo.svg's background). iOS/macOS apply their own corner
// rounding on top of this square image, so no rounding is done here.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
// Required for `output: 'export'` — this route has no dynamic params, so it
// prerenders once at build time into a static file (see app/og/docs/[...slug]/
// route.tsx for the same pattern on a dynamic route).
export const revalidate = false;

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0B0518",
      }}
    >
      {/* Rendered as vector rects (not a raster image), so it stays crisp
            at any output size instead of being blurred by resampling. */}
      <svg
        width={132}
        height={(132 * 12) / 17}
        viewBox={BUTTERFLY_VIEWBOX}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {butterflyRects.map(([x, y, fill]) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={fill}
          />
        ))}
      </svg>
    </div>,
    size,
  );
}
