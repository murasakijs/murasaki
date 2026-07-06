import { i18n } from "./i18n";
import { docsRoute } from "./shared";

/**
 * Prefix an in-content link to the docs with the active locale.
 *
 * Content MDX authors internal links as locale-agnostic absolute paths
 * (e.g. `/docs/guides/routing`). Under i18n the real routes are
 * `/docs/...` (English, unprefixed — see lib/i18n.ts's
 * `hideLocale: "default-locale"`) and `/ja/docs/...`, so an unprefixed
 * `/docs/...` link 404s on `/ja`. We rewrite it at render time (rather than
 * churning every MDX file) so a link always resolves within the page's own
 * locale — which also means translated `*.ja.mdx` pages inherit correct
 * links for free.
 *
 * Non-docs hrefs (external URLs, bare `#hash` anchors, already-prefixed
 * paths) are returned untouched.
 */
export function localizeDocsHref(
  href: string | undefined,
  lang: string,
): string | undefined {
  if (!href) return href;
  if (href === docsRoute || href.startsWith(`${docsRoute}/`)) {
    return lang === i18n.defaultLanguage ? href : `/${lang}${href}`;
  }
  return href;
}
