import { generate as DefaultImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { appName } from "@/lib/shared";
import { getPageImage, source } from "@/lib/source";

export const revalidate = false;

// This route isn't nested under `[lang]`, and ja has no translated content
// yet (it falls back to the English MDX) -- so it's kept English-only for
// now rather than generating duplicate static params for the same URL.
export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/docs/[...slug]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1), "en");
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site={appName}
    />,
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return source.getPages("en").map((page) => ({
    slug: getPageImage(page).segments,
  }));
}
