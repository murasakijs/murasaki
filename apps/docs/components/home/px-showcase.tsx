"use client";

import { gsap } from "gsap";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HomeContent, LpExtra } from "@/lib/home-content";

/**
 * The pinned proof scene — madewithgsap-style scroll choreography. On
 * desktop the panel pins for ~2.8 viewports while the scrubbed timeline
 * builds the argument: heading rises, the real `useAppMenu` code wipes in,
 * the "native window" lands, and its View menu opens by itself. The menus
 * stay genuinely interactive throughout (the scripted open uses the same
 * state as your clicks). Mobile and reduced-motion get the finished static
 * layout — every tween is `gsap.from`/`fromTo`, so nothing is hidden
 * without JS.
 */

const CODE_CARD_BG = "#101010";

interface PxShowcaseProps {
  t: HomeContent["nativeDeepDive"];
  demo: LpExtra["demo"];
  codeHtml: string;
  codeLabel: string;
}

function MenuBar({
  menus,
  open,
  setOpen,
  onReload,
}: {
  menus: LpExtra["demo"]["menus"];
  open: number | null;
  setOpen: (v: number | null) => void;
  onReload: () => void;
}) {
  const menuId = useId();

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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
            className={`lp-sans px-2.5 py-0.5 text-[13px] transition-colors ${
              open === i
                ? "bg-[#7c3aed] text-white"
                : "text-white/80 hover:bg-white/10"
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
                className="absolute left-0 top-full z-30 mt-1 w-56 origin-top-left border border-white/10 bg-[#232327]/95 py-1.5 shadow-2xl shadow-black/50 backdrop-blur-md"
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
                        className="lp-sans group flex w-full items-center justify-between px-3 py-1 text-left text-[13px] text-white/90 hover:bg-[#7c3aed]"
                      >
                        {item.label}
                        {item.shortcut && (
                          <span className="lp-mono text-[11px] text-white/40 group-hover:text-white/80">
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
      {open !== null && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setOpen(null)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function PxShowcase({ t, demo, codeHtml, codeLabel }: PxShowcaseProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Which menu the scripted timeline opens (View = last).
  const viewIndex = demo.menus.length - 1;

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const mm = gsap.matchMedia();

    // Desktop: pin + scrubbed build-up.
    mm.add(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: wrap,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.7,
            },
            defaults: { ease: "none" },
          });
          tl.from("[data-sc-char]", {
            yPercent: 115,
            stagger: 0.012,
            duration: 0.12,
          })
            .from("[data-sc-para]", { opacity: 0, y: 20, duration: 0.08 }, 0.08)
            .fromTo(
              "[data-sc-code]",
              { clipPath: "inset(0 100% 0 0)" },
              { clipPath: "inset(0 0% 0 0)", duration: 0.2 },
              0.16,
            )
            .from(
              "[data-sc-window]",
              { yPercent: 24, opacity: 0, duration: 0.16 },
              0.34,
            )
            .call(() => setOpen(null), [], 0.55)
            .call(() => setOpen(viewIndex), [], 0.6)
            .from(
              "[data-sc-fact]",
              { opacity: 0, y: 18, stagger: 0.04, duration: 0.1 },
              0.74,
            )
            // Padding so the pin doesn't release right on the last beat.
            .to({}, { duration: 0.12 });
        }, wrap);
        return () => ctx.revert();
      },
    );

    // Mobile / tablet: simple in-view reveals, no pin.
    mm.add(
      "(max-width: 1023px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          for (const sel of [
            "[data-sc-heading]",
            "[data-sc-para]",
            "[data-sc-code]",
            "[data-sc-window]",
            "[data-sc-facts]",
          ]) {
            gsap.from(sel, {
              opacity: 0,
              y: 24,
              duration: 0.7,
              ease: "power2.out",
              scrollTrigger: { trigger: sel, start: "top 85%" },
            });
          }
        }, wrap);
        return () => ctx.revert();
      },
    );

    return () => mm.revert();
  }, [viewIndex]);

  return (
    <section className="bg-[#0e0e10] text-white">
      <div ref={wrapRef} className="relative motion-safe:lg:h-[280vh]">
        <div className="motion-safe:lg:sticky motion-safe:lg:top-0 motion-safe:lg:flex motion-safe:lg:h-screen motion-safe:lg:items-center">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 motion-safe:lg:py-0">
            <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/45">
              <span className="text-[#a78bfa]">01</span> · Native proof
            </p>

            <h2
              data-sc-heading
              className="lp-display mt-5 max-w-4xl text-[clamp(2rem,4.6vw,3.6rem)] font-extrabold leading-[0.95] tracking-tight"
            >
              {t.heading.split(" ").map((word, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static heading.
                  key={i}
                  className="inline-block overflow-hidden align-bottom"
                >
                  <span
                    data-sc-char
                    className="inline-block will-change-transform"
                  >
                    {word}
                  </span>
                  {i < t.heading.split(" ").length - 1 && " "}
                </span>
              ))}
            </h2>

            <p
              data-sc-para
              className="lp-sans mt-4 max-w-2xl text-sm leading-relaxed text-white/55 sm:text-base"
            >
              {t.paragraph}
            </p>

            <div className="mt-10 grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
              {/* The code that declares the menu… */}
              <div data-sc-code className="min-w-0 will-change-[clip-path]">
                <div className="overflow-hidden border border-white/10">
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
                <p className="lp-mono mt-3 text-xs leading-relaxed text-white/40">
                  {demo.codeCaption}
                </p>
              </div>

              {/* …and the window it becomes. */}
              <div data-sc-window className="min-w-0 will-change-transform">
                <div className="overflow-hidden border border-white/10 bg-[#1a1a1e]">
                  <div className="relative flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full bg-[#ff5f57]"
                    />
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full bg-[#febc2e]"
                    />
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full bg-[#28c840]"
                    />
                    <span className="lp-mono absolute inset-x-0 text-center text-xs text-white/45">
                      {demo.windowTitle}
                    </span>
                  </div>

                  <MenuBar
                    menus={demo.menus}
                    open={open}
                    setOpen={setOpen}
                    onReload={() => setReloadKey((k) => k + 1)}
                  />

                  <AnimatePresence mode="wait" initial={false}>
                    <m.div
                      key={reloadKey}
                      initial={{ opacity: 0, scale: 0.985 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="flex min-h-52 flex-col items-center justify-center gap-4 px-6 py-9 text-center"
                    >
                      <p className="lp-display text-2xl font-bold text-white">
                        {demo.contentTitle}
                      </p>
                      <button
                        type="button"
                        onClick={() => setCount((c) => c + 1)}
                        className="lp-sans border border-white/20 px-4 py-1.5 text-sm text-white/85 transition-colors hover:border-white/45"
                      >
                        {demo.counterLabel} × {count}
                      </button>
                      <p className="lp-sans max-w-64 text-xs leading-relaxed text-white/40">
                        {demo.contentHint}
                      </p>
                    </m.div>
                  </AnimatePresence>
                </div>
                <p className="lp-mono mt-3 text-right text-xs text-white/40">
                  {demo.tryHint}
                </p>
              </div>
            </div>

            {/* The three native facts. */}
            <div data-sc-facts className="mt-12 border-t border-white/12">
              {t.bullets.map((b, i) => (
                <div
                  key={b.title}
                  data-sc-fact
                  className="grid gap-1.5 border-b border-white/12 py-4 sm:grid-cols-[6rem_1fr_1.5fr] sm:items-baseline sm:gap-8"
                >
                  <p className="lp-pixel text-[10px] uppercase tracking-[0.25em] text-[#a78bfa]">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="lp-display text-base font-bold sm:text-lg">
                    {b.title}
                  </h3>
                  <p className="lp-sans text-sm leading-relaxed text-white/50">
                    {b.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
