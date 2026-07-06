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
    <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-card-foreground">
      <code className="overflow-x-auto font-mono text-sm whitespace-pre">
        <span className="select-none text-muted-foreground">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy install command to clipboard"
        className={cn(
          "shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          copied && "text-purple-600 dark:text-purple-400",
        )}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
