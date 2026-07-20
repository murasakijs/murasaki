import generatedChangelog from "./changelog.generated.json";

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

// Generated before dev/build from the two root CHANGELOG files. Keeping file
// I/O out of the Next.js module graph prevents Turbopack from tracing the whole
// repository into the standalone server.
const changelog = generatedChangelog as Record<
  ChangelogLocale,
  ChangelogEntry[]
>;

export function getChangelog(locale: ChangelogLocale): ChangelogEntry[] {
  return changelog[locale];
}
