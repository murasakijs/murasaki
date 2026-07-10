"use client";

import Image from "next/image";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import dmgBackground from "@/assets/dmg-background.png";
import type { LpExtra } from "@/lib/home-content";
import { appName } from "@/lib/shared";
import { PixelButterfly } from "./px-pixel";

/**
 * The DMG-installer easter egg — a faithful, fully drag-and-droppable mock
 * of the real macOS "drag the app into Applications" install window, tucked
 * under Artifacts (06) since it's the payoff for the ".dmg" label up there.
 *
 * The background is the ACTUAL asset `murasaki bundle`/`installer` bakes
 * into every real DMG (packages/murasaki/assets/dmg-background.png, copied
 * here verbatim) — same greeting, same hand-drawn arrow, same caption. Only
 * the two icons are DOM elements layered on top, positioned at the exact
 * ratios `installer.ts`'s `styleVolume()` places them at in the real thing
 * (appX 165 / appsX 475 / iconY 175 over a 640×420 canvas, 128px icons) —
 * so this really is "the same DMG", not a redrawn approximation.
 *
 * Genuinely draggable (raw pointer events, matching the manual drag/paint
 * handling used elsewhere on this page rather than reaching for
 * framer-motion's `drag` — that needs the heavier `domMax` feature bundle
 * this page never otherwise loads): pick up the app icon, drop it on the
 * Applications folder, watch it "install". Nothing actually installs — the
 * caption owns that the moment it lands, the same honesty beat as the
 * playground's "just HTML" confession.
 */

// Real coordinates from packages/murasaki/src/cli/installer.ts's
// `styleVolume()` (DEFAULT_WINDOW 640×420, DEFAULT_ICON_SIZE 128), converted
// to percentages so this scales with the mockup's rendered width.
const CANVAS = { w: 640, h: 420 };
const ICON_SIZE = 128;
const APP_X = 165;
const APPS_X = 475;
const ICON_Y = 175;

const iconStyle = (centerX: number) => ({
  left: `${((centerX - ICON_SIZE / 2) / CANVAS.w) * 100}%`,
  top: `${((ICON_Y - ICON_SIZE / 2) / CANVAS.h) * 100}%`,
  width: `${(ICON_SIZE / CANVAS.w) * 100}%`,
});

const SNAP_BACK_MS = 320;
// PixelButterfly's assemble animation (104 cells, 0.15s delay + up to ~1.24s
// of stagger spread + 1.1s per-cell duration) takes ~2.5s to fully settle —
// give it a comfortable hold after that before the success state clears, or
// the mark gets yanked away mid-assemble.
const INSTALLED_MS = 3500;

export function PxDmgInstaller({
  folderLabel,
  hint,
  installedTitle,
  installedCaption,
}: LpExtra["dmgDemo"]) {
  const iconRef = useRef<HTMLButtonElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number } | null>(null);

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [installed, setInstalled] = useState(false);

  const dropOnFolder = useCallback(() => {
    setPos({ x: 0, y: 0 });
    setInstalled(true);
    window.setTimeout(() => setInstalled(false), INSTALLED_MS);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || installed) return;
    dragState.current = {
      startX: e.clientX - pos.x,
      startY: e.clientY - pos.y,
    };
    setDragging(true);
    setSnapping(false);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured — drag still works.
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragState.current) return;
    setPos({
      x: e.clientX - dragState.current.startX,
      y: e.clientY - dragState.current.startY,
    });
  };

  const endDrag = () => {
    if (!dragState.current) return;
    dragState.current = null;
    setDragging(false);

    const icon = iconRef.current;
    const folder = folderRef.current;
    if (!icon || !folder) return;
    const a = icon.getBoundingClientRect();
    const b = folder.getBoundingClientRect();
    const overlap =
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;

    if (overlap) {
      dropOnFolder();
    } else {
      setSnapping(true);
      setPos({ x: 0, y: 0 });
      window.setTimeout(() => setSnapping(false), SNAP_BACK_MS);
    }
  };

  // Keyboard equivalent — dragging itself has no keyboard analogue, so
  // Enter/Space triggers the same "install" outcome directly.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (installed) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropOnFolder();
    }
  };

  return (
    <div className="mt-16 border-t border-[#111014]/15 pt-12">
      <div className="relative mx-auto max-w-lg overflow-hidden rounded-lg border border-[#111014]/15 bg-white shadow-[0_20px_60px_-15px_rgba(17,16,20,0.25)]">
        {/* Title bar */}
        <div className="flex h-9 items-center gap-1.5 border-b border-[#111014]/10 bg-[#ececec] px-3.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <p className="lp-sans -mt-px flex-1 text-center text-[12px] font-medium text-[#111014]/60">
            {appName}
          </p>
        </div>

        {/* The real DMG background — same asset `murasaki installer` bakes
         * into an actual .dmg. Decorative: the greeting/arrow/caption it
         * draws aren't in the accessibility tree, only the two real
         * interactive elements layered on top are. */}
        <div className="relative aspect-[32/21] w-full">
          <Image
            src={dmgBackground}
            alt=""
            fill
            className="object-cover"
            sizes="(min-width: 640px) 512px, 100vw"
          />

          <button
            ref={iconRef}
            type="button"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            disabled={installed}
            aria-label={hint}
            style={{
              ...iconStyle(APP_X),
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              transition: snapping
                ? `transform ${SNAP_BACK_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`
                : installed
                  ? "opacity 0.3s ease"
                  : "none",
            }}
            className={`absolute z-10 flex touch-none flex-col items-center gap-1.5 rounded-none border-0 bg-transparent p-0 aspect-square ${
              dragging ? "cursor-grabbing" : "cursor-grab"
            } ${installed ? "pointer-events-none opacity-0" : ""}`}
          >
            <span className="flex aspect-square w-full items-center justify-center rounded-[22%] bg-[#f4f2ed] p-3 shadow-[0_6px_16px_-4px_rgba(17,16,20,0.35)]">
              <PixelButterfly className="h-full w-auto" />
            </span>
            <span className="lp-sans text-[11px] font-medium text-[#111014]/70">
              {appName}
            </span>
          </button>

          <div ref={folderRef} className="absolute" style={iconStyle(APPS_X)}>
            <svg
              aria-hidden="true"
              viewBox="0 0 64 52"
              className="aspect-square w-full drop-shadow-[0_6px_10px_rgba(17,16,20,0.2)]"
            >
              <path
                d="M2 10a4 4 0 0 1 4-4h16l6 6h30a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"
                fill="#5b8def"
              />
              <path
                d="M2 16a4 4 0 0 1 4-4h52a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"
                fill="#7ba4f4"
              />
            </svg>
            <p className="lp-sans mt-1.5 text-center text-[11px] font-medium text-[#111014]/70">
              {folderLabel}
            </p>
          </div>

          {installed && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/95">
              <PixelButterfly className="h-10 w-auto" />
              <p className="lp-display text-xl font-extrabold text-[#111014]">
                {installedTitle}
              </p>
              <p className="lp-sans max-w-xs text-center text-xs text-[#111014]/55">
                {installedCaption}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
