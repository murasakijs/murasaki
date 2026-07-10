// Generates lib/doc-dates.json: a { "<page.path>": "<ISO date>" } map of each
// doc file's last git-commit time, keyed exactly like `page.path` (relative to
// content/docs, e.g. "guides/api-routes.mdx" / "index.ja.mdx").
//
// Why a committed manifest instead of reading git at build time: the docs image
// builds with `.git` excluded from the Docker context (see repo-root
// .dockerignore), so `git log` isn't available inside the build. This script
// runs on the host/CI where git DOES exist (wired as `prebuild`), writes the
// JSON, and that JSON travels in the repo — the page reads it as plain data.
//
// Docker-safe: if git is unavailable (or a file has no history yet), the script
// leaves any existing manifest untouched and never fails the build.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const contentDir = join(appRoot, "content", "docs");
const outFile = join(appRoot, "lib", "doc-dates.json");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

function gitAvailable() {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: appRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

if (!gitAvailable()) {
  // No git in this environment (e.g. the Docker build) — keep the committed
  // manifest as-is so the build still gets whatever dates were last generated.
  console.log("[doc-dates] git unavailable — keeping existing manifest");
  process.exit(0);
}

const dates = {};
for (const file of walk(contentDir)) {
  const key = relative(contentDir, file);
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${file}"`, {
      cwd: appRoot,
      encoding: "utf8",
    }).trim();
    // Untracked / not-yet-committed files return empty — skip them so the page
    // simply omits the date rather than showing a bogus one.
    if (iso) dates[key] = iso;
  } catch {
    // Ignore individual failures; a missing key just hides that page's date.
  }
}

// Stable key order keeps the committed JSON diff-friendly.
const sorted = Object.fromEntries(
  Object.keys(dates)
    .sort()
    .map((k) => [k, dates[k]]),
);

let prev = "";
try {
  prev = readFileSync(outFile, "utf8");
} catch {
  // First run — no existing file.
}
const next = `${JSON.stringify(sorted, null, 2)}\n`;
if (next !== prev) {
  writeFileSync(outFile, next);
  console.log(`[doc-dates] wrote ${Object.keys(sorted).length} entries`);
} else {
  console.log("[doc-dates] up to date");
}
