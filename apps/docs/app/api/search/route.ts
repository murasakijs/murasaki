import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Static export has no server to answer per-query search requests, so this
// exports the full search index as a static JSON file at build time instead;
// the client (see `search: { options: { type: "static" } }` in
// app/layout.tsx) downloads it once and searches in the browser.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: "english",
});
