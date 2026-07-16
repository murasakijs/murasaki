import { notFound } from "next/navigation";
import { getLLMText, getPageMarkdownUrl, source } from "@/lib/source";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/[lang]/docs/[[...slug]]">,
) {
  const { lang, slug } = await params;
  if (lang !== "en" && lang !== "ja") notFound();
  const page = source.getPage(slug?.slice(0, -1), lang);
  if (!page) notFound();

  return new Response(await getLLMText(page, lang), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex, follow",
      Vary: "Accept",
    },
  });
}

export function generateStaticParams() {
  return (["en", "ja"] as const).flatMap((lang) =>
    source.getPages(lang).map((page) => {
      const [, , ...slug] = getPageMarkdownUrl(page, lang).segments;
      return { lang, slug };
    }),
  );
}
