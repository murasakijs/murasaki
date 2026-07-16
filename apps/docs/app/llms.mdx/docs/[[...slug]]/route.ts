import { notFound } from "next/navigation";
import { getLLMText, source } from "@/lib/source";

export const revalidate = false;

// Backwards-compatible unlocalized alias. New integrations should use the
// explicit `/llms.mdx/{lang}/docs/...` route.
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
    slug: [...page.slugs, "content.md"],
  }));
}
