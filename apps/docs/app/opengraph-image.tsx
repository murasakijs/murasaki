import { ImageResponse } from "next/og";
import { BUTTERFLY_VIEWBOX, butterflyRects } from "@/lib/butterfly-rects";
import { homeContent } from "@/lib/home-content";

// Site-level social share image (Open Graph + Twitter — see
// app/layout.tsx's `twitter` metadata, which has no `images` of its own so
// Next.js's metadata resolver falls back to this same openGraph image for
// Twitter Cards too, rather than duplicating a near-identical
// twitter-image.tsx). English-only for now: the docs/[lang] tree renders ja
// pages too, but this static image lives outside `app/[lang]` (a per-locale
// version would need its own route under each locale, which is awkward
// under `output: 'export'` for a single top-level file convention) — see
// app/[lang]/layout.tsx's generateMetadata for how `openGraph.locale` is
// still set correctly per language while reusing this one image.
export const alt = "Murasaki — Next.js DX for desktop apps";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Required for `output: 'export'` — this route has no dynamic params, so it
// prerenders once at build time into a static file (see app/og/docs/[...slug]/
// route.tsx for the same pattern on a dynamic route).
export const revalidate = false;

const PURPLE = "#A855F7";
const DEEP_PURPLE = "#5B21B6";
const DARK = "#0B0518";

export default function OpengraphImage() {
  const { bandLabel } = homeContent.en;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "88px 96px",
        background: DARK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
        <svg
          width={102}
          height={(102 * 12) / 17}
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
        <p
          style={{
            fontSize: "88px",
            fontWeight: 800,
            color: PURPLE,
            margin: 0,
            letterSpacing: "-3px",
          }}
        >
          Murasaki
        </p>
      </div>

      <p
        style={{
          fontSize: "48px",
          fontWeight: 600,
          color: "#F5F0FF",
          margin: 0,
          maxWidth: "980px",
        }}
      >
        Next.js DX for desktop apps.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <div
          style={{
            display: "flex",
            width: "56px",
            height: "10px",
            background: PURPLE,
          }}
        />
        <div
          style={{
            display: "flex",
            width: "20px",
            height: "10px",
            background: DEEP_PURPLE,
          }}
        />
        <p
          style={{
            fontSize: "24px",
            color: "rgba(240,240,240,0.6)",
            margin: 0,
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          {bandLabel}
        </p>
      </div>
    </div>,
    size,
  );
}
