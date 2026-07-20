import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  joinWrappedLine,
  parseChangelog,
  validateChangelogLocales,
} from "../lib/changelog-parser.mjs";
import { formatDocDate } from "../lib/format-doc-date.mjs";

const repoRoot = resolve(import.meta.dirname, "../../..");

test("parses and cross-validates the committed English and Japanese changelogs", async () => {
  const [enSource, jaSource, generatedSource] = await Promise.all([
    readFile(resolve(repoRoot, "CHANGELOG.md"), "utf8"),
    readFile(resolve(repoRoot, "CHANGELOG.ja.md"), "utf8"),
    readFile(
      resolve(repoRoot, "apps/docs/lib/changelog.generated.json"),
      "utf8",
    ),
  ]);
  const en = parseChangelog(enSource, "en", "CHANGELOG.md");
  const ja = parseChangelog(jaSource, "ja", "CHANGELOG.ja.md");

  assert.doesNotThrow(() => validateChangelogLocales(en, ja));
  assert.deepEqual(JSON.parse(generatedSource), { en, ja });
});

test("rejects malformed, duplicate, and unknown changelog structures", () => {
  assert.throws(
    () => parseChangelog("## v1.0.0 (2026-01-01)\n\n- bad", "en"),
    /malformed version heading/,
  );
  assert.throws(
    () =>
      parseChangelog(
        "## 1.0.0 — first (2026-01-01)\n\n- one\n\n## 1.0.0 — duplicate (2026-01-02)\n\n- two",
        "en",
      ),
    /duplicate version 1\.0\.0/,
  );
  assert.throws(
    () =>
      parseChangelog(
        "## 1.0.0 — first (2026-01-01)\n\n### Mystery\n\n- one",
        "en",
      ),
    /unknown category/,
  );
});

test("rejects English and Japanese version or date drift", () => {
  const en = parseChangelog("## 1.0.0 — first (2026-01-01)\n\n- one", "en");
  const ja = parseChangelog("## 1.0.1 — 最初 (2026-01-01)\n\n- 一つ", "ja");
  assert.throws(() => validateChangelogLocales(en, ja), /diverge at entry 1/);
});

test("joins Japanese wraps without inserting visual gaps", () => {
  assert.equal(joinWrappedLine("署名に", "よる"), "署名による");
  assert.equal(joinWrappedLine("Papelle、", "Oscilla"), "Papelle、Oscilla");
  assert.equal(joinWrappedLine("English", "words"), "English words");
});

test("formats documentation dates identically without timezone conversion", () => {
  const iso = "2026-07-20T02:47:57+09:00";
  assert.equal(formatDocDate(iso, "en"), "July 20, 2026");
  assert.equal(formatDocDate(iso, "ja"), "2026年7月20日");
});
