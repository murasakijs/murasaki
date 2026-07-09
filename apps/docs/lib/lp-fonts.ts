import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  Martian_Mono,
} from "next/font/google";

// Landing-page-only type system ("bold grotesque" art direction). These are
// deliberately NOT loaded in app/layout.tsx: the docs' typography (Inter/Geist
// + Fraunces/Zen Old Mincho via lib/fonts.ts) must stay untouched, so the
// landing page scopes these variables onto its own root element
// (app/[lang]/(home)/page.tsx) and maps them to `.lp-*` classes in
// global.css. The huge 「紫」 glyphs reuse the globally-loaded Zen Old Mincho
// (`--font-display-ja`) — no extra CJK payload.

/** Display face — the giant "Murasaki" hero type, numerals, headings. */
export const lpDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  variable: "--font-lp-display",
  display: "swap",
});

/** Body/UI face for landing copy. */
export const lpSans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-lp-sans",
  display: "swap",
});

/** Mono — spec-sheet labels, marquee, commands, window chrome. */
export const lpMono = Martian_Mono({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-lp-mono",
  display: "swap",
});

/** Convenience: every landing font variable, joined for the LP root. */
export const lpFontVariables = [
  lpDisplay.variable,
  lpSans.variable,
  lpMono.variable,
].join(" ");
