import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { i18n } from "./i18n";
import { absoluteUrl, localizedDocsPath } from "./seo";
import { docsImageRoute, docsRoute, localizedDocsContentRoute } from "./shared";

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  i18n,
  plugins: [lucideIconsPlugin()],
});

export function getPageImage(page: (typeof source)["$inferPage"]) {
  const segments = [...page.slugs, "image.png"];

  return {
    segments,
    url: `${docsImageRoute}/${segments.join("/")}`,
  };
}

export function getPageMarkdownUrl(
  page: (typeof source)["$inferPage"],
  lang: "en" | "ja",
) {
  const segments = [lang, "docs", ...page.slugs, "content.md"];

  return {
    segments,
    url: `${localizedDocsContentRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(
  page: (typeof source)["$inferPage"],
  lang: "en" | "ja" = "en",
) {
  const processed = await page.data.getText("processed");
  const canonical = absoluteUrl(localizedDocsPath(lang, page.slugs));

  return `# ${page.data.title} (${canonical})

${processed}`;
}
