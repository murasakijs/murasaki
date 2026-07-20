import { defineI18nUI } from "fumadocs-ui/i18n";

// `hideLocale: "default-locale"` hides the URL prefix for the default
// language only: English lives at `/docs/...` (no `/en`), Japanese at
// `/ja/docs/...`. English docs are a real unprefixed App Router route so
// pathname-driven Fumadocs UI hydrates deterministically; proxy.ts handles
// canonical redirects and the remaining locale rewrites.
//
// `defineI18nUI` bundles the routing config together with the language
// switcher's display names, and its `.provider(lang)` builds the
// `RootProvider`'s `i18n` prop directly — see app/[lang]/layout.tsx.
export const i18n = defineI18nUI(
  {
    defaultLanguage: "en",
    languages: ["en", "ja"],
    hideLocale: "default-locale",
  },
  {
    en: { displayName: "English" },
    ja: { displayName: "日本語" },
  },
);
