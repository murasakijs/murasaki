const VERSION_HEADING_RE =
  /^## (\d+\.\d+\.\d+) — (.+) \((\d{4}-\d{2}-\d{2})\)$/;

const CATEGORY_KIND_BY_LABEL = {
  en: { Added: "added", Fixed: "fixed", Security: "security", Notes: "notes" },
  ja: { 追加: "added", 修正: "fixed", セキュリティ: "security", 補足: "notes" },
};

function resolveCategoryKind(label, locale, filePath, lineNo) {
  if (locale === "en" && label.startsWith("Breaking changes")) {
    return "breaking";
  }
  if (locale === "ja" && label.includes("破壊的変更")) return "breaking";

  const kind = CATEGORY_KIND_BY_LABEL[locale][label];
  if (!kind) {
    throw new Error(
      `changelog: unknown category "### ${label}" at ${filePath}:${lineNo}`,
    );
  }
  return kind;
}

function isBlank(line) {
  return line.trim() === "";
}

// Kana, han, and compatibility ideographs — CJK "word" characters.
const CJK_LETTER_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
// CJK symbols/punctuation (、。「」…) and fullwidth forms (()：etc.).
const CJK_PUNCT_RE = /[　-〿！-･]/;

export function joinWrappedLine(previous, next) {
  if (previous === "") return next;
  const a = previous[previous.length - 1];
  const b = next[0];
  if (CJK_PUNCT_RE.test(a) || CJK_PUNCT_RE.test(b)) return previous + next;
  if (CJK_LETTER_RE.test(a) && CJK_LETTER_RE.test(b)) return previous + next;
  return `${previous} ${next}`;
}

function parseBody(lines, locale, filePath, headingLineNo) {
  let i = 0;
  const n = lines.length;

  const skipBlank = () => {
    while (i < n && isBlank(lines[i])) i++;
  };

  const readParagraph = () => {
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

  const readBulletList = () => {
    const items = [];
    while (i < n) {
      const line = lines[i];
      if (line.startsWith("- ")) {
        items.push(line.slice(2).trim());
        i++;
      } else if (items.length > 0 && !isBlank(line) && /^\s/.test(line)) {
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

  const intro = [];
  const sections = [];
  const outro = [];

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
      throw new Error(
        `changelog: unexpected "${lines[i]}" after outro paragraphs at ${filePath}:${headingLineNo + 1 + i}`,
      );
    }
    outro.push(paragraph);
    skipBlank();
  }

  return { intro, sections, outro };
}

export function parseChangelog(raw, locale, filePath = `${locale}.md`) {
  const allLines = raw.split("\n");
  const firstHeading = allLines.findIndex((line) => line.startsWith("## "));
  if (firstHeading === -1) {
    throw new Error(`changelog: ${filePath} has no "## " version headings`);
  }

  const entries = [];
  const seenVersions = new Set();
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

export function validateChangelogLocales(en, ja) {
  const len = Math.max(en.length, ja.length);
  for (let idx = 0; idx < len; idx++) {
    const a = en[idx];
    const b = ja[idx];
    if (!a || !b || a.version !== b.version || a.date !== b.date) {
      throw new Error(
        "changelog: CHANGELOG.md and CHANGELOG.ja.md diverge at entry " +
          `${idx + 1}: ${a ? `${a.version} (${a.date})` : "<missing>"} vs ` +
          `${b ? `${b.version} (${b.date})` : "<missing>"}`,
      );
    }
  }
}
