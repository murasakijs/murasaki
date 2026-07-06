"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — ignore.
    }
  }

  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg shadow-black/5 dark:shadow-black/20">
      {/* Faux terminal window chrome — purely decorative. */}
      <div
        aria-hidden="true"
        className="relative flex items-center gap-1.5 border-b border-border px-4 py-2.5"
      >
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="absolute inset-x-0 text-center font-mono text-xs text-muted-foreground">
          zsh
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <code className="overflow-x-auto font-mono text-sm whitespace-pre">
          <span className="select-none text-purple-500 dark:text-purple-400">
            ${" "}
          </span>
          {command}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy install command to clipboard"
          className={cn(
            "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
            copied && "text-purple-600 dark:text-purple-400",
          )}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
