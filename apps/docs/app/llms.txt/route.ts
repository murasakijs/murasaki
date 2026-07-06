import { llms } from "fumadocs-core/source";
import { source } from "@/lib/source";

export const revalidate = false;

// ja has no translated content yet (it falls back to the English MDX), so
// this stays English-only for now rather than emitting duplicate entries.
export function GET() {
  return new Response(llms(source).index("en"));
}
