"use client";

import { AnimatePresence, m } from "motion/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { butterflyRects } from "@/lib/butterfly-rects";
import type { LpExtra } from "@/lib/home-content";
import { MaskReveal } from "./lp-motion";

/**
 * The playground — a deliberately DIFFERENT register of playful than the
 * CTA's drag/physics toy: creation instead of physics. The mockup is a live
 * pixel canvas on the same 16px grid as the logo: click/drag paints
 * brand-purple cells, and right-clicking pops a fake context menu that can
 * stamp the actual pixel-butterfly (straight from butterfly-rects.ts),
 * shuffle every painted cell's color, or wipe the canvas — plus a wink of a
 * last item confessing that, unlike the native menu demoed earlier in
 * PxShowcase/nativeDeepDive, THIS one really is just HTML. Keeping that
 * distinction explicit avoids contradicting the page's own "not an HTML
 * popup" pitch.
 */

/** One canvas cell = one logo pixel = one .px-grid square. */
const CELL = 16;
/** What click/drag paints. */
const BRUSH = "#7c3aed";
/** Shuffle recolors painted cells across the brand's purple ladder. */
const SHUFFLE_PALETTE = ["#7c3aed", "#a855f7", "#c026d3", "#5b21b6"];
/** Approx menu footprint used to clamp its position inside the canvas. */
const MENU_W = 248;
const MENU_H = 168;

/** Grid offset where the seeded butterfly sits (left-aligned, like the
 * page's typography). */
const SEED_COL = 3;
const SEED_ROW = 3;

function stampInto(
  cells: ReadonlyMap<string, string>,
  baseCol: number,
  baseRow: number,
): Map<string, string> {
  const next = new Map(cells);
  for (const [x, y, fill] of butterflyRects) {
    next.set(`${baseCol + x},${baseRow + y}`, fill);
  }
  return next;
}

/** The canvas starts with the brand mark already painted. Module-level and
 * never mutated (every update copies), so it's safe to share. Seeded cells
 * skip the pop-in `initial` — otherwise SSR emits them at opacity 0 and
 * they'd stay invisible until (unless) client animation runs. */
const SEEDED = stampInto(new Map(), SEED_COL, SEED_ROW);

export function PxPlayground({
  eyebrow,
  heading,
  hint,
  items,
  caption,
}: LpExtra["playground"]) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [cells, setCells] = useState<ReadonlyMap<string, string>>(SEEDED);

  const openMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    drawing.current = false;
    setMenu({
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width - MENU_W)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height - MENU_H)),
    });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const paintAt = useCallback((clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      return;
    }
    const col = Math.floor((clientX - rect.left) / CELL);
    const row = Math.floor((clientY - rect.top) / CELL);
    setCells((prev) => {
      const key = `${col},${row}`;
      if (prev.get(key) === BRUSH) return prev;
      const next = new Map(prev);
      next.set(key, BRUSH);
      return next;
    });
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only the primary button paints, and never while the fake menu is up
    // (its item clicks — and the click-away backdrop — bubble up here).
    if (e.button !== 0 || menu) return;
    paintAt(e.clientX, e.clientY);
    // Touch stays tap-to-paint so `touch-pan-y` keeps page scroll working;
    // mouse/pen get capture + drag drawing.
    if (e.pointerType === "touch") return;
    drawing.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic / already-released pointers can't be captured — drawing
      // still works within the canvas, it just won't follow outside it.
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drawing.current) paintAt(e.clientX, e.clientY);
  };

  const stopDrawing = () => {
    drawing.current = false;
  };

  const stampButterfly = () => {
    if (!menu) return;
    // Center the 17×12 mark on the click point, snapped to the grid.
    const baseCol = Math.round(menu.x / CELL) - 8;
    const baseRow = Math.round(menu.y / CELL) - 6;
    setCells((prev) => stampInto(prev, baseCol, baseRow));
    setMenu(null);
  };

  const shufflePalette = () => {
    setCells(
      (prev) =>
        new Map(
          [...prev.keys()].map((key) => [
            key,
            SHUFFLE_PALETTE[Math.floor(Math.random() * SHUFFLE_PALETTE.length)],
          ]),
        ),
    );
    setMenu(null);
  };

  const clearCanvas = () => {
    setCells(new Map());
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

        {/* biome-ignore lint/a11y/noStaticElementInteractions: decorative pixel-canvas toy, not a semantic control — same escape hatch as px-showcase.tsx. */}
        <div
          ref={hostRef}
          onContextMenu={openMenu}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          className="relative mt-14 h-72 cursor-crosshair touch-pan-y select-none overflow-hidden border border-[#111014]/15 bg-white sm:h-96"
        >
          <div
            aria-hidden="true"
            className="px-grid pointer-events-none absolute inset-0 text-[#111014]/[0.06]"
          />

          {/* Painted cells. Seeded cells render with `initial={false}` so
           * the SSR HTML already shows them at full opacity (no-JS safe);
           * live-painted cells get the pop-in. Shuffle recolors animate via
           * backgroundColor — a color animation, so it survives MotionConfig
           * reducedMotion="user". */}
          {[...cells].map(([key, color]) => {
            const [c, r] = key.split(",").map(Number);
            return (
              <m.div
                key={key}
                initial={SEEDED.has(key) ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, backgroundColor: color }}
                transition={{ duration: 0.12 }}
                className="pointer-events-none absolute"
                style={{
                  left: c * CELL,
                  top: r * CELL,
                  width: CELL,
                  height: CELL,
                  backgroundColor: color,
                }}
              />
            );
          })}

          <p className="lp-mono pointer-events-none absolute bottom-4 right-4 text-[11px] uppercase tracking-[0.2em] text-[#111014]/35">
            {hint}
          </p>

          {/* The (fake) context menu. */}
          <AnimatePresence>
            {menu && (
              <m.ul
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.12, ease: "easeOut" }}
                style={{ left: menu.x, top: menu.y }}
                className="absolute z-30 w-60 origin-top-left cursor-default border border-[#111014]/15 bg-white py-1.5 shadow-2xl shadow-black/10"
              >
                <li>
                  <button
                    type="button"
                    onClick={stampButterfly}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#7c3aed] hover:text-white"
                  >
                    {items.stamp}
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
                <li>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[#7c3aed] hover:text-white"
                  >
                    {items.clear}
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
