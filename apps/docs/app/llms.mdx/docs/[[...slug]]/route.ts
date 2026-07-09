import { notFound } from "next/navigation";
import { getLLMText, getPageMarkdownUrl, source } from "@/lib/source";

export const revalidate = false;

// This route isn't nested under `[lang]`, and ja has no translated content
// yet (it falls back to the English MDX) -- so it's kept English-only for
// now rather than generating duplicate static params for the same URL.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug?.slice(0, -1), "en");
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex, follow",
      Vary: "Accept",
    },
  });
}

export function generateStaticParams() {
  return source.getPages("en").map((page) => ({
    slug: getPageMarkdownUrl(page).segments,
  }));
}
