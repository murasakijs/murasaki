import { RootProvider } from "fumadocs-ui/provider/next";
import LocalizedDocsLayout from "@/app/[lang]/docs/layout";
import { i18n } from "@/lib/i18n";

// The default locale is a real route instead of a rewrite to `/en/docs`.
// Fumadocs derives active navigation and TOC state from `usePathname()`;
// keeping the server route and visible browser URL both on `/docs` avoids a
// server/client pathname split during hydration.
export default async function Layout({ children }: LayoutProps<"/docs">) {
  const localized = await LocalizedDocsLayout({
    children,
    params: Promise.resolve({ lang: i18n.defaultLanguage }),
  });

  return (
    <RootProvider i18n={i18n.provider(i18n.defaultLanguage)}>
      {localized}
    </RootProvider>
  );
}
