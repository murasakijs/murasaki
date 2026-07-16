import { buildLlmsApi } from "@/lib/llms";

export const revalidate = false;

export function GET() {
  return new Response(buildLlmsApi(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex, follow",
    },
  });
}
