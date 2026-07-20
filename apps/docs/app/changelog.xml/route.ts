import { getChangelog } from "@/lib/changelog";
import { absoluteUrl } from "@/lib/seo";

export const revalidate = false;

const CHANNEL_DESCRIPTION =
  "Every dated release of Murasaki, the Next.js DX framework for native desktop apps.";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const items = getChangelog("en")
    .map((entry) => {
      const anchor = `v${entry.version.replaceAll(".", "-")}`;
      const link = absoluteUrl(`/changelog#${anchor}`);
      const title = escapeXml(`v${entry.version} — ${entry.title}`);
      const pubDate = new Date(`${entry.date}T00:00:00Z`).toUTCString();

      return `    <item>
      <title>${title}</title>
      <link>${escapeXml(link)}</link>
      <guid>${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Murasaki Changelog</title>
    <link>${escapeXml(absoluteUrl("/changelog"))}</link>
    <description>${escapeXml(CHANNEL_DESCRIPTION)}</description>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
