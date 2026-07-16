import configSchema from "../../../packages/mcp/content/config-schema.json";
import capabilities from "../../../packages/murasaki/capabilities.json";
import { absoluteUrl, localizedDocsPath } from "./seo";
import { getLLMText, source } from "./source";

type Language = "en" | "ja";

function description(page: (typeof source)["$inferPage"]) {
  return page.data.description?.trim() || "Murasaki documentation.";
}

function pageUrl(page: (typeof source)["$inferPage"], lang: Language) {
  return absoluteUrl(localizedDocsPath(lang, page.slugs));
}

const sectionOrder = [
  "",
  "getting-started",
  "core-concepts",
  "guides",
  "components",
  "building",
];

function orderedPages(lang: Language) {
  return [...source.getPages(lang)].sort((left, right) => {
    const leftSection = left.slugs[0] ?? "";
    const rightSection = right.slugs[0] ?? "";
    const leftIndex = sectionOrder.indexOf(leftSection);
    const rightIndex = sectionOrder.indexOf(rightSection);
    const sectionDifference =
      (leftIndex === -1 ? sectionOrder.length : leftIndex) -
      (rightIndex === -1 ? sectionOrder.length : rightIndex);
    if (sectionDifference !== 0) return sectionDifference;
    return left.slugs.join("/").localeCompare(right.slugs.join("/"), lang);
  });
}

export function buildLlmsIndex() {
  const pages = orderedPages("en");
  const essential = pages.filter((page) => page.slugs[0] !== "components");
  const components = pages.filter((page) => page.slugs[0] === "components");
  const lines = [
    "# Murasaki",
    "",
    "> Next.js-style developer experience for Rust-native desktop apps using React 19, Vite, and the operating system WebView.",
    "",
    `Current framework version: ${capabilities.frameworkVersion} (pre-1.0).`,
    "Capability labels are normative: planned features are unavailable; partial and experimental features must be used with their documented limitations.",
    `Canonical feature matrix: ${absoluteUrl("/docs/core-concepts/platform-feature-status")}`,
    "",
    "## Documentation",
    "",
    ...essential.map(
      (page) =>
        `- [${page.data.title}](${pageUrl(page, "en")}): ${description(page)}`,
    ),
    "",
    "## Optional",
    "",
    `- [UI component reference](${absoluteUrl("/docs/components")}): ${components.length} component and UI-kit pages.`,
    `- [Japanese documentation](${absoluteUrl("/ja/docs")}): Japanese-language documentation.`,
    `- [Complete English and Japanese corpus](${absoluteUrl("/llms-full.txt")}): Full processed Markdown in navigation order.`,
    `- [API, configuration, and compatibility data](${absoluteUrl("/llms-api.txt")}): Machine-readable public symbols, maturity labels, limitations, and JSON Schema.`,
    `- [Per-page Markdown](${absoluteUrl("/llms.mdx/en/docs/content.md")}): Replace the page slug and keep the /content.md suffix.`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildLlmsFull() {
  const sections = await Promise.all(
    (["en", "ja"] as const).map(async (lang) => {
      const pages = orderedPages(lang);
      const content = await Promise.all(
        pages.map((page) => getLLMText(page, lang)),
      );
      return `# ${lang === "en" ? "English" : "日本語"}\n\n${content.join("\n\n---\n\n")}`;
    }),
  );
  return [
    "# Murasaki complete documentation corpus",
    "",
    `Framework version: ${capabilities.frameworkVersion} (pre-1.0).`,
    "Status rule: planned is unavailable; partial and experimental entries retain every limitation stated in the capability manifest.",
    "",
    ...sections,
    "",
  ].join("\n");
}

export function buildLlmsApi() {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedFrom: {
        capabilities: "packages/murasaki/capabilities.json",
        config: "packages/mcp/content/config-schema.json",
      },
      capabilities,
      configSchema,
    },
    null,
    2,
  )}\n`;
}
