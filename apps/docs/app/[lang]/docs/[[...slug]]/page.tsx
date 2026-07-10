import { Card } from "fumadocs-ui/components/card";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPageFooter } from "@/components/doc-page-footer";
import { getMDXComponents } from "@/components/mdx";
import docDates from "@/lib/doc-dates.json";
import { localizeDocsHref } from "@/lib/localize-href";
import { gitConfig } from "@/lib/shared";
import { getPageImage, getPageMarkdownUrl, source } from "@/lib/source";

export default async function Page(
  props: PageProps<"/[lang]/docs/[[...slug]]">,
) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  // Resolve relative in-content links against the current file...
  const RelativeLink = createRelativeLink(source, page);

  // GitHub blob URL for the exact source file (same shape as the top toolbar's
  // "view options"), plus its last-commit date from the build-time git
  // manifest (absent when the file has no history yet — see gen-doc-dates.mjs).
  const editUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`;
  const isoDate = (docDates as Record<string, string>)[page.path];

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // Locale-prefix absolute `/docs/...` links (see localizeDocsHref),
            // then let createRelativeLink resolve any relative file-path links.
            a: ({ href, ...props }) => (
              <RelativeLink href={localizeDocsHref(href, lang)} {...props} />
            ),
            // `<Card href>` isn't touched by createRelativeLink, so localize it
            // here too — used by the `<Cards>` navigation blocks in the MDX.
            Card: ({ href, ...props }) => (
              <Card href={localizeDocsHref(href, lang)} {...props} />
            ),
          })}
        />
      </DocsBody>
      <DocPageFooter lang={lang} editUrl={editUrl} isoDate={isoDate} />
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/[lang]/docs/[[...slug]]">,
): Promise<Metadata> {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
