import { defineI18nUI } from "fumadocs-ui/i18n";

// `hideLocale: "default-locale"` hides the URL prefix for the default
// language only: English lives at `/docs/...` (no `/en`), Japanese at
// `/ja/docs/...`. This is a runtime rewrite/redirect done by the i18n
// middleware in proxy.ts, which requires a real server — now that this app
// is dynamically hosted (not `output: "export"`), that's available.
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
