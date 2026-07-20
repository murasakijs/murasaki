import { i18n } from "./i18n";

export const defaultSiteUrl = "https://murasaki.ichi10.com";

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

// `origin` removes accidental trailing paths/slashes; an invalid configured
// value fails the build instead of silently publishing bad canonical URLs.
export const siteUrl = new URL(configuredSiteUrl || defaultSiteUrl).origin;

export function absoluteUrl(path = "/") {
  return new URL(path, `${siteUrl}/`).toString();
}

export function localizedHomePath(lang: string) {
  return lang === i18n.defaultLanguage ? "/" : `/${lang}`;
}

export function localizedDocsPath(lang: string, slugs: readonly string[] = []) {
  const suffix = slugs.length > 0 ? `/${slugs.join("/")}` : "";
  const docsPath = `/docs${suffix}`;

  return lang === i18n.defaultLanguage ? docsPath : `/${lang}${docsPath}`;
}

export function localizedChangelogPath(lang: string) {
  return lang === i18n.defaultLanguage ? "/changelog" : `/${lang}/changelog`;
}

export function localizedAlternates(pathForLanguage: (lang: string) => string) {
  return {
    ...Object.fromEntries(
      i18n.languages.map((lang) => [lang, pathForLanguage(lang)]),
    ),
    "x-default": pathForLanguage(i18n.defaultLanguage),
  };
}
