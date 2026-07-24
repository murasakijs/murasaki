import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const componentsDir = resolve(
  import.meta.dirname,
  "../content/docs/components",
);
const docsDir = resolve(import.meta.dirname, "../content/docs");

async function json(name) {
  return JSON.parse(await readFile(resolve(componentsDir, name), "utf8"));
}

async function text(name) {
  return readFile(resolve(componentsDir, name), "utf8");
}

function catalogPages(meta) {
  return meta.pages.filter(
    (page) => page !== "index" && !page.startsWith("---"),
  );
}

test("the component catalog has matching English/Japanese navigation, pages, and index cards", async () => {
  const [englishMeta, japaneseMeta, englishIndex, japaneseIndex, filenames] =
    await Promise.all([
      json("meta.json"),
      json("meta.ja.json"),
      text("index.mdx"),
      text("index.ja.mdx"),
      readdir(componentsDir),
    ]);

  const pages = catalogPages(englishMeta);
  assert.deepEqual(catalogPages(japaneseMeta), pages);
  assert.equal(
    new Set(pages).size,
    pages.length,
    "component navigation contains duplicate slugs",
  );

  const documentedEnglish = new Set(
    filenames
      .filter((name) => name.endsWith(".mdx") && !name.endsWith(".ja.mdx"))
      .map((name) => name.slice(0, -".mdx".length))
      .filter((name) => name !== "index"),
  );
  const documentedJapanese = new Set(
    filenames
      .filter((name) => name.endsWith(".ja.mdx"))
      .map((name) => name.slice(0, -".ja.mdx".length))
      .filter((name) => name !== "index"),
  );

  assert.deepEqual([...documentedEnglish].sort(), [...pages].sort());
  assert.deepEqual([...documentedJapanese].sort(), [...pages].sort());

  for (const slug of pages) {
    const href = `href="/docs/components/${slug}"`;
    assert.equal(
      englishIndex.split(href).length - 1,
      1,
      `English component index must link ${slug} exactly once`,
    );
    assert.equal(
      japaneseIndex.split(href).length - 1,
      1,
      `Japanese component index must link ${slug} exactly once`,
    );
  }
});

test("every component detail page includes an interactive preview", async () => {
  const englishMeta = await json("meta.json");
  const pages = catalogPages(englishMeta);
  const previewPattern = /<(?:ComponentPreview|ComponentPlayground)\b/;

  for (const slug of pages) {
    const [englishPage, japanesePage] = await Promise.all([
      text(`${slug}.mdx`),
      text(`${slug}.ja.mdx`),
    ]);

    assert.match(
      englishPage,
      previewPattern,
      `English ${slug} page must include an interactive preview`,
    );
    assert.match(
      japanesePage,
      previewPattern,
      `Japanese ${slug} page must include an interactive preview`,
    );
  }
});

test("framework UI guidance identifies React Aria as the current foundation", async () => {
  const [englishStyling, japaneseStyling, englishIndex, japaneseIndex] =
    await Promise.all([
      readFile(resolve(docsDir, "guides/styling.mdx"), "utf8"),
      readFile(resolve(docsDir, "guides/styling.ja.mdx"), "utf8"),
      readFile(resolve(docsDir, "index.mdx"), "utf8"),
      readFile(resolve(docsDir, "index.ja.mdx"), "utf8"),
    ]);

  for (const content of [
    englishStyling,
    japaneseStyling,
    englishIndex,
    japaneseIndex,
  ]) {
    assert.match(content, /React Aria/);
    assert.doesNotMatch(content, /\bRadix\b/);
  }
});
