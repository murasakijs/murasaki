import { buildLlmsFull } from "@/lib/llms";

export const revalidate = false;

export async function GET() {
  return new Response(await buildLlmsFull(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, follow",
    },
  });
}
