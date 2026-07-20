import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseChangelog,
  validateChangelogLocales,
} from "../lib/changelog-parser.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..", "..");
const outFile = join(appRoot, "lib", "changelog.generated.json");

const en = parseChangelog(
  readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"),
  "en",
  "CHANGELOG.md",
);
const ja = parseChangelog(
  readFileSync(join(repoRoot, "CHANGELOG.ja.md"), "utf8"),
  "ja",
  "CHANGELOG.ja.md",
);

validateChangelogLocales(en, ja);

const next = `${JSON.stringify({ en, ja }, null, 2)}\n`;
let previous = "";
try {
  previous = readFileSync(outFile, "utf8");
} catch {
  // First generation.
}

if (next === previous) {
  console.log(`[changelog] up to date (${en.length} releases)`);
} else {
  writeFileSync(outFile, next);
  console.log(`[changelog] wrote ${en.length} releases`);
}
