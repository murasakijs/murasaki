import type { MetadataRoute } from "next";
import { i18n } from "@/lib/i18n";
import {
  absoluteUrl,
  localizedChangelogPath,
  localizedDocsPath,
  localizedHomePath,
} from "@/lib/seo";
import { source } from "@/lib/source";

// Page metadata already publishes the equivalent hreflang links. Keep this
// feed to the core sitemap schema so strict consumers see the same simple
// loc/changefreq/priority ordering as the main ichi10.com sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  const homes: MetadataRoute.Sitemap = i18n.languages.map((lang) => ({
    url: absoluteUrl(localizedHomePath(lang)),
    changeFrequency: "weekly",
    priority: lang === i18n.defaultLanguage ? 1 : 0.9,
  }));

  const docsPages: MetadataRoute.Sitemap = i18n.languages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      url: absoluteUrl(localizedDocsPath(lang, page.slugs)),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  );

  const changelog: MetadataRoute.Sitemap = i18n.languages.map((lang) => ({
    url: absoluteUrl(localizedChangelogPath(lang)),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...homes, ...docsPages, ...changelog];
}
