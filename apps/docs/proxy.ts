import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";
import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { i18n } from "@/lib/i18n";
import { docsContentRoute, docsRoute } from "@/lib/shared";

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`,
);

// Locale routing (see lib/i18n.ts's `hideLocale: "default-locale"`): rewrites
// unprefixed paths (`/`, `/docs/...`) internally to the default language
// (`/en/...`) so English ships with no URL prefix, and redirects an explicit
// `/en/...` down to its unprefixed form; `/ja/...` is left untouched.
const i18nMiddleware = createI18nMiddleware(i18n);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // `docsRoute` (`/docs`) is the unprefixed — i.e. default-language — docs
  // path, so this negotiation only needs to run before the i18n rewrite
  // above ever touches the request, not after: it matches the same paths
  // either way.
  const result = rewriteSuffix(request.nextUrl.pathname);
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(request.nextUrl.pathname);

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }

  return i18nMiddleware(request, event);
}

export const config = {
  // Run on everything except: Next.js internals, the API route (its own
  // locale-less `/api/search`), and the top-level asset/metadata routes that
  // live outside `app/[lang]/**` (favicons, `llms*.txt`, the llms.mdx and OG
  // image routes) — none of those should get rewritten under a locale.
  matcher: [
    "/((?!_next/static|_next/image|api|favicon\\.ico|icon\\.svg|apple-icon|opengraph-image|llms\\.txt|llms-full\\.txt|llms\\.mdx|og/).*)",
  ],
};
