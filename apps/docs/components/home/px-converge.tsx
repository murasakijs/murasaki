"use client";

import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";

/**
 * A faint purple "digital rain" behind the converge headline — Matrix in
 * Murasaki's palette: brand-purple glyphs (katakana ムラサキ + binary +
 * pixel symbols) on a canvas, kept subtle via low opacity. Motion-gated,
 * paused while offscreen (IntersectionObserver), and fps-capped, so it
 * costs almost nothing; reduced-motion gets no canvas at all.
 */
const RAIN_GLYPHS = "ムラサキ01＋＝：＃・";
const RAIN_FONT = 16; // logical px per cell

function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let drops: number[] = [];

    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${RAIN_FONT}px monospace`;
      ctx.textBaseline = "top";
      const next = Math.ceil(w / RAIN_FONT);
      drops = Array.from(
        { length: next },
        (_, i) => drops[i] ?? Math.random() * -40,
      );
      cols = next;
      ctx.clearRect(0, 0, w, h);
    };
    resize();

    let raf = 0;
    let last = 0;
    const STEP = 1000 / 18; // ~18fps — digital rain reads fine slow and cheap
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < STEP) return;
      last = t;
      // Trailing fade toward the section's ink background (#0e0e10).
      ctx.fillStyle = "rgba(14, 14, 16, 0.18)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#7c3aed";
      for (let i = 0; i < cols; i++) {
        const ch = RAIN_GLYPHS[(Math.random() * RAIN_GLYPHS.length) | 0];
        const y = drops[i] * RAIN_FONT;
        ctx.fillText(ch, i * RAIN_FONT, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        else drops[i] += 1;
      }
    };

    const start = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(draw);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start();
      else stop();
    });
    io.observe(host);
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      // Decorative rain. Left with no ARIA at all on purpose: an empty
      // <canvas> (no fallback content, no accessible name) is already
      // ignored by assistive tech, and Biome treats <canvas> as both
      // focusable and interactive — so `aria-hidden` and `role` each trip
      // a different a11y rule. `pointer-events-none` keeps it inert.
      className="pointer-events-none absolute inset-0 opacity-[0.18]"
    />
  );
}

/**
 * The converging headline — the madewithgsap hero move, in Murasaki's
 * vocabulary: the viewport pins while "Native apps." slides in from the
 * left and "Web DX." from the right until they meet as one sentence, a
 * purple `×` popping in between them (native × web — the crossover).
 * Desktop pins for ~2 viewports; mobile/reduced-motion get the finished
 * line. A faint purple digital rain sits behind it (see MatrixRain).
 */
export function PxConverge({ left, right }: { left: string; right: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const mm = gsap.matchMedia();
    mm.add(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
      () => {
        const ctx = gsap.context(() => {
          // Pin styling lives HERE, not in CSS: it only exists when this
          // animation actually runs (JS + desktop + motion allowed), so
          // no-JS/reduced-motion/mobile all get normal document flow.
          gsap.set(wrap, { height: "220vh" });
          // Pin below the fixed site header, not under it — measured live
          // so the scene's first line (the index label) stays visible.
          const navH = document.querySelector("header")?.offsetHeight ?? 56;
          gsap.set("[data-px-sticky]", {
            position: "sticky",
            top: navH,
            height: `calc(100vh - ${navH}px)`,
            paddingTop: 0,
            paddingBottom: 0,
          });
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: wrap,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.6,
            },
            defaults: { ease: "none" },
          });
          tl.from("[data-cv-left]", { xPercent: -85, duration: 0.6 }, 0)
            .from("[data-cv-right]", { xPercent: 85, duration: 0.6 }, 0)
            .from(
              "[data-cv-dot]",
              { scale: 0, opacity: 0, duration: 0.12, ease: "steps(3)" },
              0.55,
            )
            // Hold the finished line for a beat before the pin releases.
            .to({}, { duration: 0.3 });
        }, wrap);
        return () => ctx.revert();
      },
    );
    return () => mm.revert();
  }, []);

  return (
    <section className="bg-[#0e0e10] text-white">
      <div ref={wrapRef} className="relative">
        <div
          data-px-sticky
          className="relative flex items-center justify-center overflow-hidden py-24"
        >
          <MatrixRain />
          <h2 className="lp-display relative z-10 flex flex-col items-center gap-3 px-6 text-center text-[clamp(2.4rem,7.5vw,7rem)] font-extrabold leading-[0.95] tracking-tight lg:flex-row lg:gap-[0.35em] lg:whitespace-nowrap">
            <span data-cv-left className="inline-block will-change-transform">
              {left}
            </span>
            {/* Meaningful, not decorative — it reads as "native cross web"
             * (the collab/crossover ×), so it's exposed to AT with an
             * explicit label (a bare "×" glyph is dropped under some
             * punctuation-verbosity settings). */}
            <span
              data-cv-dot
              role="img"
              aria-label="cross"
              className="inline-block text-[0.6em] font-extrabold leading-none text-[#7c3aed]"
            >
              ×
            </span>
            <span data-cv-right className="inline-block will-change-transform">
              {right}
            </span>
          </h2>
        </div>
      </div>
    </section>
  );
}
