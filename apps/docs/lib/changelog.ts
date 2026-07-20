import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Server-only: reads CHANGELOG.md / CHANGELOG.ja.md from the repo root at
// build time. Every page that imports this is statically rendered, so a
// parse failure here fails `next build` instead of shipping bad content.

export type ChangelogLocale = "en" | "ja";

export type ChangelogSectionKind =
  | "added"
  | "fixed"
  | "security"
  | "notes"
  | "breaking"
  | "changes";

export interface ChangelogSection {
  kind: ChangelogSectionKind;
  /** The heading text as written in the source file (empty for bare-bullet
   * entries with no `###` category — rendered without a category heading). */
  label: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  intro: string[];
  sections: ChangelogSection[];
  outro: string[];
}

const FILE_NAMES: Record<ChangelogLocale, string> = {
  en: "CHANGELOG.md",
  ja: "CHANGELOG.ja.md",
};

const VERSION_HEADING_RE =
  /^## (\d+\.\d+\.\d+) — (.+) \((\d{4}-\d{2}-\d{2})\)$/;

const CATEGORY_KIND_BY_LABEL: Record<
  ChangelogLocale,
  Record<string, ChangelogSectionKind>
> = {
  en: { Added: "added", Fixed: "fixed", Security: "security", Notes: "notes" },
  ja: { 追加: "added", 修正: "fixed", セキュリティ: "security", 補足: "notes" },
};

/** Walks up from `startDir` to find the directory containing `CHANGELOG.md`
 * (the repo root) — more robust than a hardcoded `../..` since the exact
 * depth of `process.cwd()` under the repo root isn't a contract worth
 * hardcoding. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "CHANGELOG.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `changelog: could not find CHANGELOG.md by walking up from ${startDir}`,
      );
    }
    dir = parent;
  }
}

function resolveCategoryKind(
  label: string,
  locale: ChangelogLocale,
  filePath: string,
  lineNo: number,
): ChangelogSectionKind {
  if (locale === "en" && label.startsWith("Breaking changes"))
    return "breaking";
  if (locale === "ja" && label.includes("破壊的変更")) return "breaking";

  const kind = CATEGORY_KIND_BY_LABEL[locale][label];
  if (!kind) {
    throw new Error(
      `changelog: unknown category "### ${label}" at ${filePath}:${lineNo}`,
    );
  }
  return kind;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

// Kana, han, and compatibility ideographs — CJK "word" characters.
const CJK_LETTER_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
// CJK symbols/punctuation (、。「」…) and fullwidth forms (()：etc.).
const CJK_PUNCT_RE = /[　-〿！-･]/;

/** Joins a hard-wrapped source line onto the text accumulated so far.
 * English wrapping needs the space back; Japanese wrapping must NOT gain
 * one — a space between two CJK letters, or around CJK punctuation, renders
 * as a visible gap mid-sentence (e.g. "署名に よる", "Papelle、 Oscilla").
 * A CJK-letter/latin boundary keeps the space, matching how the Japanese
 * files space around inline latin terms. */
function joinWrappedLine(previous: string, next: string): string {
  if (previous === "") return next;
  const a = previous[previous.length - 1];
  const b = next[0];
  if (CJK_PUNCT_RE.test(a) || CJK_PUNCT_RE.test(b)) return previous + next;
  if (CJK_LETTER_RE.test(a) && CJK_LETTER_RE.test(b)) return previous + next;
  return `${previous} ${next}`;
}

/** Parses one version's body (the lines between its `## ` heading and the
 * next one): optional intro paragraphs, then either bare bullets or
 * `### Category` sections, then optional outro paragraphs. */
function parseBody(
  lines: string[],
  locale: ChangelogLocale,
  filePath: string,
  headingLineNo: number,
): Pick<ChangelogEntry, "intro" | "sections" | "outro"> {
  let i = 0;
  const n = lines.length;

  const skipBlank = () => {
    while (i < n && isBlank(lines[i])) i++;
  };

  const readParagraph = (): string => {
    let paragraph = "";
    while (
      i < n &&
      !isBlank(lines[i]) &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("- ")
    ) {
      paragraph = joinWrappedLine(paragraph, lines[i].trim());
      i++;
    }
    return paragraph;
  };

  const readBulletList = (): string[] => {
    const items: string[] = [];
    while (i < n) {
      const line = lines[i];
      if (line.startsWith("- ")) {
        items.push(line.slice(2).trim());
        i++;
      } else if (items.length > 0 && !isBlank(line) && /^\s/.test(line)) {
        // Continuation of the previous bullet (an indented source line).
        items[items.length - 1] = joinWrappedLine(
          items[items.length - 1],
          line.trim(),
        );
        i++;
      } else {
        break;
      }
    }
    return items;
  };

  const intro: string[] = [];
  const sections: ChangelogSection[] = [];
  const outro: string[] = [];

  skipBlank();
  while (i < n && !lines[i].startsWith("### ") && !lines[i].startsWith("- ")) {
    intro.push(readParagraph());
    skipBlank();
  }

  while (i < n && (lines[i].startsWith("### ") || lines[i].startsWith("- "))) {
    if (lines[i].startsWith("### ")) {
      const lineNo = headingLineNo + 1 + i;
      const label = lines[i].slice(4).trim();
      i++;
      skipBlank();
      const items = readBulletList();
      sections.push({
        kind: resolveCategoryKind(label, locale, filePath, lineNo),
        label,
        items,
      });
    } else {
      sections.push({ kind: "changes", label: "", items: readBulletList() });
    }
    skipBlank();
  }

  while (i < n) {
    if (isBlank(lines[i])) {
      skipBlank();
      continue;
    }
    const paragraph = readParagraph();
    if (paragraph === "") {
      // readParagraph consumed nothing: the line is a "### " category or a
      // "- " bullet appearing after outro paragraphs. Without this guard the
      // loop would spin forever — fail the build loudly instead.
      throw new Error(
        `changelog: unexpected "${lines[i]}" after outro paragraphs at ${filePath}:${headingLineNo + 1 + i}`,
      );
    }
    outro.push(paragraph);
    skipBlank();
  }

  return { intro, sections, outro };
}

function parseFile(
  filePath: string,
  locale: ChangelogLocale,
): ChangelogEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const allLines = raw.split("\n");
  const firstHeading = allLines.findIndex((line) => line.startsWith("## "));
  if (firstHeading === -1) {
    throw new Error(`changelog: ${filePath} has no "## " version headings`);
  }

  const entries: ChangelogEntry[] = [];
  const seenVersions = new Set<string>();
  let i = firstHeading;

  while (i < allLines.length) {
    const line = allLines[i];
    if (!line.startsWith("## ")) {
      i++;
      continue;
    }

    const lineNo = i + 1;
    const match = VERSION_HEADING_RE.exec(line);
    if (!match) {
      throw new Error(
        `changelog: malformed version heading at ${filePath}:${lineNo}: ${JSON.stringify(line)}`,
      );
    }
    const [, version, title, date] = match;
    if (seenVersions.has(version)) {
      throw new Error(
        `changelog: duplicate version ${version} at ${filePath}:${lineNo}`,
      );
    }
    seenVersions.add(version);

    const bodyStart = i + 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < allLines.length && !allLines[bodyEnd].startsWith("## ")) {
      bodyEnd++;
    }
    const body = parseBody(
      allLines.slice(bodyStart, bodyEnd),
      locale,
      filePath,
      lineNo,
    );
    if (
      body.intro.length === 0 &&
      body.sections.length === 0 &&
      body.outro.length === 0
    ) {
      throw new Error(
        `changelog: empty version body for ${version} at ${filePath}:${lineNo}`,
      );
    }

    entries.push({ version, date, title, ...body });
    i = bodyEnd;
  }

  return entries;
}

let cache: Record<ChangelogLocale, ChangelogEntry[]> | null = null;

/** Parses both locale files once per process, cross-validates that they
 * list the same versions in the same order (translation may differ freely
 * in title/section/bullet content), and memoizes the result. */
function loadChangelogs(): Record<ChangelogLocale, ChangelogEntry[]> {
  if (cache) return cache;

  const root = findRepoRoot(process.cwd());
  const enPath = join(root, FILE_NAMES.en);
  const jaPath = join(root, FILE_NAMES.ja);
  if (!existsSync(jaPath)) {
    throw new Error(
      `changelog: ${jaPath} not found (expected alongside ${FILE_NAMES.en})`,
    );
  }

  const en = parseFile(enPath, "en");
  const ja = parseFile(jaPath, "ja");

  const len = Math.max(en.length, ja.length);
  for (let idx = 0; idx < len; idx++) {
    const a = en[idx];
    const b = ja[idx];
    if (!a || !b || a.version !== b.version || a.date !== b.date) {
      throw new Error(
        `changelog: ${FILE_NAMES.en} and ${FILE_NAMES.ja} diverge at entry ${idx + 1}: ` +
          `${a ? `${a.version} (${a.date})` : "<missing>"} vs ` +
          `${b ? `${b.version} (${b.date})` : "<missing>"}`,
      );
    }
  }

  cache = { en, ja };
  return cache;
}

export function getChangelog(locale: ChangelogLocale): ChangelogEntry[] {
  return loadChangelogs()[locale];
}
