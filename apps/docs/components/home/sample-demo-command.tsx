"use client";

import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

export function SampleDemoCommand({
  command,
  label,
  copyLabel,
  copiedLabel,
}: {
  command: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    let didCopy = false;

    try {
      await navigator.clipboard.writeText(command);
      didCopy = true;
    } catch {
      const input = document.createElement("textarea");
      input.value = command;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      didCopy = document.execCommand("copy");
      input.remove();
    }

    if (!didCopy) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 5000);
  }

  return (
    <div className="mt-3 overflow-hidden border border-white/20 bg-[#17121f]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <span className="lp-pixel flex min-w-0 items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-white/55">
          <Terminal aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <button
          type="button"
          onClick={copyCommand}
          aria-label={copied ? copiedLabel : copyLabel}
          title={copied ? copiedLabel : copyLabel}
          className="shrink-0 p-1 text-white/55 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>
      <code className="lp-mono block overflow-x-auto whitespace-nowrap px-3 py-2.5 text-[10px] text-white/70">
        <span aria-hidden="true" className="select-none text-[#a78bfa]">
          ${" "}
        </span>
        {command}
      </code>
    </div>
  );
}
