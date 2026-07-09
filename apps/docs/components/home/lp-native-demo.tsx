"use client";

import { AnimatePresence, m } from "motion/react";
import { useEffect, useId, useState } from "react";
import type { HomeContent, LpExtra } from "@/lib/home-content";
import { EASE, MaskReveal, SceneLabel } from "./lp-motion";

/**
 * Proof-by-demo: instead of a screenshot, a LIVE mock of a native window —
 * a titlebar, a menu bar whose menus actually open (View → Reload really
 * "reloads" the window content), beside the real `useAppMenu` code that
 * produces it in a Murasaki app. The product's whole point, demonstrated.
 */

const CODE_CARD_BG = "#101010";

interface LpNativeDemoProps {
  t: HomeContent["nativeDeepDive"];
  demo: LpExtra["demo"];
  codeHtml: string;
  codeLabel: string;
}

function MenuBar({
  menus,
  onReload,
}: {
  menus: LpExtra["demo"]["menus"];
  onReload: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const menuId = useId();

  // Escape closes, like a real menu.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative flex items-center gap-0.5 border-b border-white/10 px-2 py-1">
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            aria-expanded={open === i}
            aria-controls={`${menuId}-${i}`}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => {
              if (open !== null && open !== i) setOpen(i);
            }}
            className={`lp-sans rounded px-2.5 py-0.5 text-[13px] transition-colors ${
              open === i
                ? "bg-purple-600 text-white"
                : "text-purple-100/90 hover:bg-white/10"
            }`}
          >
            {menu.label}
          </button>
          <AnimatePresence>
            {open === i && (
              <m.ul
                id={`${menuId}-${i}`}
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -2 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                className="absolute left-0 top-full z-30 mt-1 w-56 origin-top-left rounded-lg border border-white/10 bg-[#1c1728]/95 py-1.5 shadow-2xl shadow-black/50 backdrop-blur-md"
              >
                {menu.items.map((item, j) =>
                  item.divider ? (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: dividers have no identity.
                      key={`div-${j}`}
                      aria-hidden="true"
                      className="mx-3 my-1 h-px bg-white/10"
                    />
                  ) : (
                    <li key={item.label}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(null);
                          if (item.shortcut === "⌘R") onReload();
                        }}
                        className="lp-sans group flex w-full items-center justify-between px-3 py-1 text-left text-[13px] text-purple-50 hover:bg-purple-600"
                      >
                        {item.label}
                        {item.shortcut && (
                          <span className="lp-mono text-[11px] text-purple-200/50 group-hover:text-white/80">
                            {item.shortcut}
                          </span>
                        )}
                      </button>
                    </li>
                  ),
                )}
              </m.ul>
            )}
          </AnimatePresence>
        </div>
      ))}
      {/* Click-away layer while a menu is open. */}
      {open !== null && (
        // biome-ignore lint/a11y/noStaticElementInteractions: invisible click-away helper, Escape also closes.
        <div
          className="fixed inset-0 z-20"
          onClick={() => setOpen(null)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function NativeWindow({ demo }: { demo: LpExtra["demo"] }) {
  const [count, setCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="overflow-hidden rounded-xl border border-white/12 bg-[#151020] shadow-[0_24px_80px_-24px_rgba(88,28,135,0.55)]">
      {/* Titlebar. */}
      <div className="relative flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span aria-hidden="true" className="size-3 rounded-full bg-[#ff5f57]" />
        <span aria-hidden="true" className="size-3 rounded-full bg-[#febc2e]" />
        <span aria-hidden="true" className="size-3 rounded-full bg-[#28c840]" />
        <span className="lp-mono absolute inset-x-0 text-center text-xs text-purple-200/60">
          {demo.windowTitle}
        </span>
      </div>

      <MenuBar menus={demo.menus} onReload={() => setReloadKey((k) => k + 1)} />

      {/* Window content — View → Reload re-mounts it with a pop. */}
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={reloadKey}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex min-h-56 flex-col items-center justify-center gap-4 px-6 py-10 text-center"
        >
          <p className="lp-display text-2xl font-bold text-purple-50">
            {demo.contentTitle}
          </p>
          <button
            type="button"
            onClick={() => setCount((c) => c + 1)}
            className="lp-sans rounded-lg border border-purple-300/30 px-4 py-1.5 text-sm text-purple-100 transition-colors hover:border-purple-300/60 hover:bg-purple-400/10"
          >
            {demo.counterLabel} × {count}
          </button>
          <p className="lp-sans max-w-64 text-xs leading-relaxed text-purple-200/50">
            {demo.contentHint}
          </p>
        </m.div>
      </AnimatePresence>
    </div>
  );
}

export function LpNativeDemo({ t, demo, codeHtml, codeLabel }: LpNativeDemoProps) {
  return (
    <section className="relative bg-[#0b0a12] py-24 text-purple-50 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SceneLabel index="01" code="NATIVE PROOF" />

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {t.heading}
        </MaskReveal>

        <m.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="motion-reveal lp-sans mt-5 max-w-2xl text-base leading-relaxed text-purple-200/70 sm:text-lg"
        >
          {t.paragraph}
        </m.p>

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          {/* The code that declares the menu… */}
          <m.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="motion-reveal min-w-0"
          >
            <div className="overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-purple-950/30">
              <div
                className="lp-mono flex items-center border-b border-white/10 px-4 py-2.5 text-xs text-neutral-400"
                style={{ backgroundColor: CODE_CARD_BG }}
              >
                {codeLabel}
              </div>
              <div
                className="overflow-auto [&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:p-5 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed"
                style={{ backgroundColor: CODE_CARD_BG }}
                // Build-time Shiki output for a verbatim docs snippet — not user input.
                // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, build-time HTML.
                dangerouslySetInnerHTML={{ __html: codeHtml }}
              />
            </div>
            <p className="lp-mono mt-3 text-xs leading-relaxed text-purple-300/60">
              {demo.codeCaption}
            </p>
          </m.div>

          {/* …and the "native" window it becomes. */}
          <m.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
            className="motion-reveal relative min-w-0"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-6 -z-10 rounded-[2rem] bg-purple-500/20 blur-[70px]"
            />
            <NativeWindow demo={demo} />
            <p className="lp-mono mt-3 text-right text-xs text-purple-300/60">
              {demo.tryHint}
            </p>
          </m.div>
        </div>

        {/* Spec rows — the three native facts. */}
        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3">
          {t.bullets.map((b, i) => (
            <m.div
              key={b.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.55, ease: EASE, delay: i * 0.08 }}
              className="motion-reveal bg-[#0e0b18] p-6"
            >
              <p className="lp-mono text-[10px] uppercase tracking-[0.3em] text-purple-400">
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="lp-display mt-3 text-lg font-bold">{b.title}</h3>
              <p className="lp-sans mt-2 text-sm leading-relaxed text-purple-200/60">
                {b.description}
              </p>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}
