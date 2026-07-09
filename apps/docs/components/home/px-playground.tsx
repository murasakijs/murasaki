"use client";

import { AnimatePresence, m } from "motion/react";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { LpExtra } from "@/lib/home-content";
import { MaskReveal } from "./lp-motion";
import { PixelButterfly } from "./px-pixel";

/**
 * The playground — a deliberately DIFFERENT register of playful than the
 * CTA's drag/physics toy: discovery-based (right-click) rather than
 * pointer-drag, and a self-aware joke rather than a physical toy. Right-
 * clicking the mockup pops a real DOM context menu with two actions (spawn
 * a pixel butterfly, shuffle the icon palette) plus a wink of a last item
 * confessing that — unlike the native menu demoed earlier in
 * PxShowcase/nativeDeepDive — THIS one really is just HTML. Keeping that
 * distinction explicit avoids contradicting the page's own "not an HTML
 * popup" pitch.
 */

const PALETTE = ["#7c3aed", "#a855f7", "#c026d3", "#5b21b6", "#7c3aed"];

interface SpawnedButterfly {
  id: number;
  x: number;
  y: number;
  drift: number;
}

export function PxPlayground({
  eyebrow,
  heading,
  hint,
  items,
  caption,
}: LpExtra["playground"]) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [butterflies, setButterflies] = useState<SpawnedButterfly[]>([]);
  const [shuffleKey, setShuffleKey] = useState(0);
  const nextId = useRef(0);
  const menuId = useId();

  const openMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const spawnButterfly = () => {
    if (!menu) return;
    const id = nextId.current++;
    setButterflies((b) => [
      ...b,
      { id, x: menu.x, y: menu.y, drift: id % 2 === 0 ? 44 : -44 },
    ]);
    setMenu(null);
  };

  const shufflePalette = () => {
    setShuffleKey((k) => k + 1);
    setMenu(null);
  };

  return (
    <section className="bg-[#f4f2ed] py-24 text-[#111014] sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-[#111014]/50">
          <span className="text-[#7c3aed]">04</span> · {eyebrow}
        </p>

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {heading}
        </MaskReveal>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: decorative right-click surface, not a semantic control — mirrors the same pattern in px-showcase.tsx. */}
        <div
          ref={hostRef}
          onContextMenu={openMenu}
          className="relative mt-14 h-72 select-none overflow-hidden border border-[#111014]/15 bg-white sm:h-96"
        >
          <div
            aria-hidden="true"
            className="px-grid pointer-events-none absolute inset-0 text-[#111014]/[0.06]"
          />

          {/* A few pixel "icons" — purely decorative, cycle color on shuffle. */}
          <div className="pointer-events-none absolute left-8 top-8 flex gap-4">
            {[0, 1, 2, 3].map((i) => (
              <m.span
                key={`${i}-${shuffleKey}`}
                className="block size-6"
                style={{ backgroundColor: PALETTE[0] }}
                animate={{ backgroundColor: PALETTE }}
                transition={{ duration: 1.6, delay: i * 0.06 }}
              />
            ))}
          </div>

          <p className="lp-mono pointer-events-none absolute bottom-4 right-4 text-[11px] uppercase tracking-[0.2em] text-[#111014]/35">
            {hint}
          </p>

          {/* Spawned butterflies — fly up, fade, then remove themselves. */}
          <AnimatePresence>
            {butterflies.map((b) => (
              <m.div
                key={b.id}
                initial={{ opacity: 0, scale: 0.6, x: b.x, y: b.y }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  y: b.y - 130,
                  x: b.x + b.drift,
                }}
                transition={{ duration: 1.6, ease: "easeOut" }}
                onAnimationComplete={() =>
                  setButterflies((cur) => cur.filter((c) => c.id !== b.id))
                }
                className="pointer-events-none absolute left-0 top-0 w-10"
              >
                <PixelButterfly className="h-auto w-full" />
              </m.div>
            ))}
          </AnimatePresence>

          {/* The (fake) context menu. */}
          <AnimatePresence>
            {menu && (
              <m.ul
                id={menuId}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                style={{ left: menu.x, top: menu.y }}
                className="absolute z-30 w-60 origin-top-left border border-[#111014]/15 bg-white py-1.5 shadow-2xl shadow-black/10"
              >
                <li>
                  <button
                    type="button"
                    onClick={spawnButterfly}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#7c3aed] hover:text-white"
                  >
                    {items.spawn}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={shufflePalette}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#7c3aed] hover:text-white"
                  >
                    {items.shuffle}
                  </button>
                </li>
                <li
                  aria-hidden="true"
                  className="mx-3 my-1 h-px bg-[#111014]/10"
                />
                <li className="px-3 py-1.5 text-[12px] italic text-[#111014]/40">
                  {items.confession}
                </li>
              </m.ul>
            )}
          </AnimatePresence>
          {menu && (
            <div
              className="fixed inset-0 z-20"
              onClick={() => setMenu(null)}
              aria-hidden="true"
            />
          )}
        </div>

        <p className="lp-sans mt-6 max-w-2xl text-sm leading-relaxed text-[#111014]/55">
          {caption}
        </p>
      </div>
    </section>
  );
}
