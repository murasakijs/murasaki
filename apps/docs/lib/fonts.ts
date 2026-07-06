import {
  Fraunces,
  Geist_Mono,
  Noto_Sans_JP,
  Zen_Old_Mincho,
} from "next/font/google";

// Editorial display serif for `en` headlines — a true variable font so any
// `font-weight` between 100–900 works, and `.font-display` (global.css)
// dials in a high `opsz` (optical size) axis value for the high-contrast
// display cut at large sizes.
export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal"],
  variable: "--font-display-en",
  display: "swap",
});

// Editorial display mincho for `ja` headlines — the ja counterpart to
// `fraunces`, swapped in purely by `.font-display`'s `:lang(ja)` override in
// global.css (see the `lang` attribute set on the home page's root element).
// Single weight (matches the `font-bold` headlines actually use): like
// Noto Sans JP below, this is a CJK-glyph font — Google doesn't offer real
// subsetting for those, so every extra weight multiplies an already-large
// unicode-range chunk set. Not preloaded for the same reason.
export const zenOldMincho = Zen_Old_Mincho({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-display-ja",
  display: "swap",
  preload: false,
});

// Mono for uppercase eyebrows/labels and code, wired into Tailwind's
// `font-mono` utility via the `--font-mono` indirection in global.css's
// `@theme inline` block (mirrors how `--font-sans`/Geist is wired below).
export const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Japanese body/UI sans — Geist itself ships no CJK glyphs. Not preloaded:
// Google doesn't offer real subsetting for CJK fonts, so the file is large
// and shouldn't block first paint. Picked up by the `:lang(ja)` rule in
// global.css so ja-scoped text renders consistently instead of falling back
// to whatever Japanese system font the OS/browser happens to pick.
export const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans-ja",
  display: "swap",
  preload: false,
});
