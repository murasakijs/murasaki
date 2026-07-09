import type { MetadataRoute } from "next";
import { i18n } from "@/lib/i18n";
import { absoluteUrl, localizedDocsPath, localizedHomePath } from "@/lib/seo";
import { source } from "@/lib/source";

function homeAlternates() {
  return {
    ...Object.fromEntries(
      i18n.languages.map((lang) => [
        lang,
        absoluteUrl(localizedHomePath(lang)),
      ]),
    ),
    "x-default": absoluteUrl(localizedHomePath(i18n.defaultLanguage)),
  };
}

function docsAlternates(slugs: readonly string[]) {
  const languages = Object.fromEntries(
    i18n.languages.flatMap((lang) =>
      source.getPage([...slugs], lang)
        ? [[lang, absoluteUrl(localizedDocsPath(lang, slugs))]]
        : [],
    ),
  );
  const defaultPage = source.getPage([...slugs], i18n.defaultLanguage);

  return defaultPage
    ? {
        ...languages,
        "x-default": absoluteUrl(
          localizedDocsPath(i18n.defaultLanguage, slugs),
        ),
      }
    : languages;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const homes: MetadataRoute.Sitemap = i18n.languages.map((lang) => ({
    url: absoluteUrl(localizedHomePath(lang)),
    changeFrequency: "weekly",
    priority: lang === i18n.defaultLanguage ? 1 : 0.9,
    alternates: { languages: homeAlternates() },
  }));

  const docsPages: MetadataRoute.Sitemap = i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      url: absoluteUrl(localizedDocsPath(lang, page.slugs)),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: { languages: docsAlternates(page.slugs) },
    })),
  );

  return [...homes, ...docsPages];
}
