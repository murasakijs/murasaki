import LocalizedPage, {
  generateMetadata as generateLocalizedMetadata,
} from "@/app/[lang]/docs/[[...slug]]/page";
import { i18n } from "@/lib/i18n";
import { source } from "@/lib/source";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await props.params;

  return LocalizedPage({
    params: Promise.resolve({ lang: i18n.defaultLanguage, slug }),
    searchParams: Promise.resolve({}),
  });
}

export function generateStaticParams() {
  return source
    .generateParams()
    .filter(({ lang }) => lang === i18n.defaultLanguage)
    .map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await props.params;

  return generateLocalizedMetadata({
    params: Promise.resolve({ lang: i18n.defaultLanguage, slug }),
    searchParams: Promise.resolve({}),
  });
}
