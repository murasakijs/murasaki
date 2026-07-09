import { ImageResponse } from "next/og";
import { BUTTERFLY_VIEWBOX, butterflyRects } from "@/lib/butterfly-rects";

// Site-level social share image (Open Graph + Twitter). The composition mirrors
// the landing page's editorial art direction: graph paper, oversized grotesque
// type, a ghosted 紫, pixel details, and a compact terminal command.
export const alt = "Murasaki — Next.js DX for desktop apps";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = false;

const PAPER = "#f4f2ed";
const INK = "#111014";
const PURPLE = "#7c3aed";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: "62px 72px 54px",
        color: INK,
        backgroundColor: PAPER,
        backgroundImage:
          "linear-gradient(rgba(17,16,20,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(17,16,20,0.055) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    >
      <div
        style={{
          position: "absolute",
          right: "-34px",
          top: "-112px",
          display: "flex",
          fontFamily: "serif",
          fontSize: "500px",
          fontWeight: 800,
          lineHeight: 1,
          color: "rgba(17,16,20,0.045)",
        }}
      >
        紫
      </div>

      <div
        style={{
          position: "absolute",
          right: "58px",
          top: "60px",
          display: "flex",
          opacity: 0.92,
        }}
      >
        <svg
          width={178}
          height={(178 * 12) / 17}
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
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          fontFamily: "monospace",
          fontSize: "15px",
          fontWeight: 700,
          letterSpacing: "5px",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: PURPLE, marginRight: "14px" }}>01</span>
        React 19 · Vite · Rust-native
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "48px",
          fontSize: "142px",
          fontWeight: 900,
          letterSpacing: "-8px",
          lineHeight: 0.83,
        }}
      >
        Murasaki
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "36px",
          fontSize: "38px",
          fontWeight: 700,
          letterSpacing: "-1.2px",
        }}
      >
        Next.js DX for desktop apps.
      </div>

      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "stretch",
          gap: "18px",
        }}
      >
        <div
          style={{
            width: "570px",
            height: "74px",
            display: "flex",
            alignItems: "center",
            border: "2px solid rgba(17,16,20,0.82)",
            background: INK,
            color: "#f8f6f1",
            padding: "0 24px",
            fontFamily: "monospace",
            fontSize: "25px",
            boxShadow: "9px 9px 0 rgba(124,58,237,0.18)",
          }}
        >
          <span style={{ color: "#a855f7", marginRight: "14px" }}>$</span>
          pnpm create murasaki@latest my-app
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "flex-end",
            fontFamily: "monospace",
            fontSize: "14px",
            fontWeight: 700,
            letterSpacing: "2.5px",
            textTransform: "uppercase",
          }}
        >
          Native windows&nbsp;&nbsp;·&nbsp;&nbsp;No Rust required
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "14px",
          display: "flex",
          backgroundImage:
            "repeating-conic-gradient(#7c3aed 0% 25%, #111014 0% 50%)",
          backgroundSize: "14px 14px",
        }}
      />
    </div>,
    size,
  );
}
