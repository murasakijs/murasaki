import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import type { NextRequest } from "next/server";
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

// Next can run proxy again for an internal rewrite in development/standalone
// mode. Mark that request so `/docs -> /en/docs` is not immediately treated as
// a user-visible `/en/docs` request and redirected back to `/docs`.
const INTERNAL_LOCALE_REWRITE = "x-murasaki-internal-locale-rewrite";

function handleLocale(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // English docs have their own unprefixed App Router route. Serving it
  // directly keeps Next's server and browser pathname identical; rewriting
  // `/docs` to `/en/docs` makes pathname-driven Fumadocs UI hydrate with a
  // different active sidebar item and TOC label (React error #418).
  if (pathname === docsRoute || pathname.startsWith(`${docsRoute}/`)) {
    return NextResponse.next();
  }

  const [, firstSegment] = pathname.split("/");
  const pathLocale = i18n.languages.find(
    (language) => language === firstSegment,
  );

  if (request.headers.get(INTERNAL_LOCALE_REWRITE) === "1") {
    return NextResponse.next();
  }

  if (!pathLocale) {
    const url = request.nextUrl.clone();
    url.pathname = `/${i18n.defaultLanguage}${pathname}`.replaceAll(
      /\/+/g,
      "/",
    );
    const headers = new Headers(request.headers);
    headers.set(INTERNAL_LOCALE_REWRITE, "1");

    return NextResponse.rewrite(url, { request: { headers } });
  }

  if (pathLocale === i18n.defaultLanguage) {
    const url = request.nextUrl.clone();
    url.pathname = `/${pathname.split("/").slice(2).join("/")}`.replaceAll(
      /\/+/g,
      "/",
    );
    const response = NextResponse.redirect(url);
    response.cookies.set("FD_LOCALE", pathLocale, { path: "/" });
    return response;
  }

  return NextResponse.next();
}

export default function proxy(request: NextRequest) {
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

  return handleLocale(request);
}

export const config = {
  // Run on everything except: Next.js internals, the API route (its own
  // locale-less `/api/search`), and the top-level asset/metadata routes that
  // live outside `app/[lang]/**` (favicons, robots/sitemap, the changelog RSS
  // feed, `llms*.txt`, the llms.mdx and OG image routes) — none should be
  // rewritten under a locale.
  matcher: [
    "/((?!_next/static|_next/image|api|favicon\\.ico|icon\\.svg|apple-icon|opengraph-image|robots\\.txt|sitemap\\.xml|changelog\\.xml|llms\\.txt|llms-full\\.txt|llms-api\\.txt|llms\\.mdx|og/).*)",
  ],
};
