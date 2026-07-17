import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const sharpPath = pathToFileURL(
  "/Users/ichi/Documents/dev/murasaki-oss/murasaki/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js",
).href;
const { default: sharp } = await import(sharpPath);

const width = 1200;
const height = 675;
const frames = 12;
const outDir = new URL("../assets/social/", import.meta.url);

await mkdir(outDir, { recursive: true });

const faviconSvg = await readFile(new URL("../apps/docs/app/icon.svg", import.meta.url), "utf8");
const faviconRects = faviconSvg.match(/<rect[\s\S]*?\/>/g)?.join("") ?? "";

const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const grid = () => {
  const lines = [];
  for (let x = 0; x <= width; x += 32) {
    lines.push(`<path d="M${x} 0V${height}"/>`);
  }
  for (let y = 0; y <= height; y += 32) {
    lines.push(`<path d="M0 ${y}H${width}"/>`);
  }
  return `<g stroke="#17151b" stroke-opacity=".075" stroke-width="1">${lines.join("")}</g>`;
};

const butterfly = (x, y, frame, scale = 1) => {
  const size = 76 * scale;
  const wingScale = [1, 0.72, 0.38, 0.72][frame % 4];
  const flapLift = [0, -4, -8, -4][frame % 4];
  return `
    <svg x="${x - size / 2}" y="${y - size / 2 + flapLift}" width="${size}" height="${size}" viewBox="0 0 19 19" shape-rendering="crispEdges">
      <g transform="translate(9.5 0) scale(${wingScale} 1) translate(-9.5 0)">
        ${faviconRects}
      </g>
    </svg>`;
};

const shell = ({ headline, kicker, content, frame, butterflyX, butterflyY }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f3f0e8"/>
  ${grid()}
  <rect x="0" y="0" width="${width}" height="14" fill="#7c3aed"/>
  <text x="72" y="70" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" letter-spacing="4" fill="#5b21b6">MURASAKI / DESKTOP DX</text>
  <text x="72" y="150" font-family="Arial Black, Inter, sans-serif" font-weight="900" font-size="92" letter-spacing="-5" fill="#111014">${escape(headline)}</text>
  <text x="76" y="190" font-family="Inter, Arial, sans-serif" font-size="23" fill="#4c4653">${escape(kicker)}</text>
  ${content}
  ${butterfly(butterflyX, butterflyY, frame, 0.82)}
  <text x="72" y="635" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="2" fill="#756d7d">REACT 19 · VITE · RUST-NATIVE</text>
  <rect x="1090" y="616" width="38" height="8" fill="#7c3aed"/>
  <rect x="1137" y="616" width="12" height="8" fill="#a855f7" opacity="${frame % 2 ? 1 : 0.25}"/>
</svg>`;

const routingFrame = (frame) => {
  const travel = frame / (frames - 1);
  const easedTravel = travel * travel * (3 - 2 * travel);
  const active = frame % 3;
  const cards = [
    ["/", "page.tsx"],
    ["/about", "about/page.tsx"],
    ["/blog/:slug", "blog/[slug]/page.tsx"],
  ];
  const content = `
    <path d="M180 352H1015" stroke="#17151b" stroke-width="3" stroke-dasharray="8 10"/>
    ${cards
      .map(([route, file], index) => {
        const x = 72 + index * 365;
        const lit = index === active;
        return `<g>
          <rect x="${x}" y="270" width="305" height="165" rx="18" fill="${lit ? "#17151b" : "#fffdfa"}" stroke="${lit ? "#17151b" : "#b9b1bf"}" stroke-width="2"/>
          <circle cx="${x + 28}" cy="${310}" r="8" fill="#7c3aed"/>
          <text x="${x + 48}" y="320" font-family="Arial Black, Inter, sans-serif" font-size="30" fill="${lit ? "#f3f0e8" : "#17151b"}">${route}</text>
          <text x="${x + 28}" y="382" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" fill="${lit ? "#bda4ff" : "#6b6272"}">${file}</text>
        </g>`;
      })
      .join("")}
    <rect x="72" y="475" width="1035" height="78" rx="14" fill="#17151b"/>
    <text x="102" y="523" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" fill="#f3f0e8"><tspan fill="#a855f7">$</tspan> routes generated — no router config</text>`;
  return shell({
    headline: "ROUTES, NOT CONFIG.",
    kicker: "File-based routing for native desktop apps.",
    content,
    frame,
    butterflyX: 170 + easedTravel * 835,
    butterflyY: 250 - Math.sin(Math.PI * travel) * 55 + Math.sin(Math.PI * travel * 3) * 10,
  });
};

const serverFrame = (frame) => {
  const travel = frame / (frames - 1);
  const easedTravel = travel * travel * (3 - 2 * travel);
  const progress = 345 + frame * 43;
  const content = `
    <rect x="72" y="258" width="430" height="220" rx="20" fill="#17151b"/>
    <text x="105" y="310" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#a855f7">src/actions.ts</text>
    <text x="105" y="357" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="27" fill="#f3f0e8">'use server'</text>
    <text x="105" y="399" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#d4ced9">defineAction(async () =&gt; {</text>
    <text x="105" y="433" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#d4ced9">  return data</text>
    <text x="105" y="462" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" fill="#d4ced9">})</text>
    <path d="M535 370H920" stroke="#9f67ff" stroke-width="8" stroke-linecap="round"/>
    <path d="M892 344L928 370L892 396" fill="none" stroke="#9f67ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${Math.min(progress, 900)}" y="361" width="20" height="18" rx="4" fill="#f3f0e8" stroke="#5b21b6" stroke-width="3"/>
    <rect x="955" y="258" width="180" height="220" rx="20" fill="#fffdfa" stroke="#17151b" stroke-width="3"/>
    <text x="1045" y="335" text-anchor="middle" font-family="Arial Black, Inter, sans-serif" font-size="34" fill="#17151b">NODE</text>
    <text x="1045" y="378" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" fill="#6b6272">function stays</text>
    <text x="1045" y="406" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" fill="#6b6272">server-side</text>
    <rect x="72" y="510" width="1063" height="54" rx="12" fill="#7c3aed" opacity="${0.76 + (frame % 3) * 0.1}"/>
    <text x="104" y="545" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="19" fill="#fff">typed fetch stub → bundled Node server</text>`;
  return shell({
    headline: "SERVER ACTIONS.",
    kicker: "The React 19 shape you know, inside a native app.",
    content,
    frame,
    butterflyX: 558 + easedTravel * 335,
    butterflyY: 348 - Math.sin(Math.PI * travel) * 48 + Math.sin(Math.PI * travel * 3) * 8,
  });
};

const apiFrame = (frame) => {
  const travel = frame / (frames - 1);
  const easedTravel = travel * travel * (3 - 2 * travel);
  const methods = ["GET", "POST", "PUT", "PATCH"];
  const active = frame % methods.length;
  const content = `
    ${methods
      .map((method, index) => {
        const y = 255 + index * 68;
        const lit = index === active;
        return `<g>
          <rect x="72" y="${y}" width="175" height="48" rx="24" fill="${lit ? "#7c3aed" : "#17151b"}"/>
          <text x="159" y="${y + 31}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" font-weight="700" fill="#fff">${method}</text>
          <path d="M262 ${y + 24}H430" stroke="#8f8795" stroke-width="2" stroke-dasharray="7 8"/>
        </g>`;
      })
      .join("")}
    <rect x="430" y="242" width="705" height="292" rx="22" fill="#17151b"/>
    <text x="466" y="288" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" fill="#a855f7">src/api/hello/route.ts</text>
    <text x="466" y="345" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="23" fill="#f3f0e8">export const GET = async () =&gt; {</text>
    <text x="500" y="395" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="23" fill="#d4ced9">return Response.json({</text>
    <text x="540" y="442" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="23" fill="#bda4ff">ok: true<tspan opacity="${frame % 2 ? 1 : 0.25}">_</tspan></text>
    <text x="500" y="489" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="23" fill="#d4ced9">})</text>
    <text x="466" y="520" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="23" fill="#f3f0e8">}</text>`;
  return shell({
    headline: "YOUR LOCAL API.",
    kicker: "Web-standard Request and Response, powered by Node.",
    content,
    frame,
    butterflyX: 325 + easedTravel * 610,
    butterflyY: 245 - Math.sin(Math.PI * travel) * 58 + Math.sin(Math.PI * travel * 3) * 10,
  });
};

async function writeGif(filename, render) {
  const images = Array.from({ length: frames }, (_, frame) => Buffer.from(render(frame)));
  await sharp(images, { join: { animated: true } })
    .gif({ delay: [...Array(frames - 1).fill(400), 1200], loop: 0, colours: 128, effort: 8, dither: 0.65 })
    .toFile(fileURLToPath(new URL(filename, outDir)));
}

await Promise.all([
  writeGif("routing-brand-post.gif", routingFrame),
  writeGif("server-actions-brand-post.gif", serverFrame),
  writeGif("api-routes-brand-post.gif", apiFrame),
]);
