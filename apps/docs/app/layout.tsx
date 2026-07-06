import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { Metadata } from "next";
import { Geist, Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "murasaki",
  description: "Next.js DX for desktop apps. React 19 + Vite + Rust-native.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(inter.className, "font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        {/* `type: "static"` switches the search dialog to fetch the static
            search index exported by app/api/search/route.ts's `staticGET`
            and search it client-side (needed since static export has no
            server to answer per-query search requests). */}
        <RootProvider search={{ options: { type: "static" } }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
