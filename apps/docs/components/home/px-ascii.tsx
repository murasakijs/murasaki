"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";
import { butterflyRects } from "@/lib/butterfly-rects";
import type { LpExtra } from "@/lib/home-content";
import { MaskReveal } from "./lp-motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * The ASCII butterfly. The brand mark's 17×12 pixel grid
 * (butterfly-rects.ts) is extruded into voxels — one cube per pixel, split
 * into two wing groups that flap around the body axis — and rendered as
 * text via three.js AsciiEffect: one butterfly, centered, hovering in
 * place on a slow turntable. Drag for the full 360° view.
 *
 * Deliberately MONOCHROME. AsciiEffect's color mode emits a colored
 * <span> per character cell (~7k spans rebuilt via innerHTML every frame)
 * and made scrolling past the section stutter; plain-text mode swaps a
 * single text blob per frame and is what keeps this cheap. The flying
 * flock version lost that trade. The render loop is also capped at ~30fps
 * and paused entirely while the section is offscreen.
 *
 * three.js lazy-loads exactly like the CTA's Matter.js: a once
 * ScrollTrigger dynamic-imports it when the section approaches. Until then
 * — and forever, for no-JS / no-WebGL visitors — a static ASCII butterfly
 * derived from the same pixel data holds the frame.
 */

/** Static fallback: the mark rasterized to text straight from the shared
 * pixel data (chars doubled to fix the ~1:2 glyph aspect). */
const ASCII_FALLBACK = (() => {
  const rows = Array.from({ length: 12 }, () => new Array(17).fill("  "));
  for (const [x, y, fill] of butterflyRects) {
    rows[y][x] = fill === "#5B21B6" ? "%%" : fill === "#FAF5E8" ? "::" : "@@";
  }
  return rows.map((r) => r.join("")).join("\n");
})();

export function PxAscii({
  eyebrow,
  heading,
  hint,
  caption,
}: LpExtra["asciiButterfly"]) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cleanup: (() => void) | undefined;
    const trigger = ScrollTrigger.create({
      trigger: host,
      start: "top 95%",
      once: true,
      onEnter: () => {
        void (async () => {
          const [THREE, { AsciiEffect }] = await Promise.all([
            import("three"),
            import("three/examples/jsm/effects/AsciiEffect.js"),
          ]);
          if (!hostRef.current) return;

          const width = host.clientWidth;
          const height = host.clientHeight;
          const reduce = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;

          let renderer: InstanceType<typeof THREE.WebGLRenderer>;
          try {
            renderer = new THREE.WebGLRenderer({ antialias: false });
          } catch {
            return; // No WebGL — the static ASCII fallback stays up.
          }
          renderer.setSize(width, height);

          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0x000000);

          const camera = new THREE.PerspectiveCamera(
            40,
            width / height,
            1,
            100,
          );
          camera.position.z = 24;

          // Voxelize the mark into a body-axis rig: every pixel becomes a
          // cube parented to its wing's group (the mark has no x=8 column —
          // that gap IS the body line), so the wings flap by rotating
          // around Y.
          const butterfly = new THREE.Group();
          const leftWing = new THREE.Group();
          const rightWing = new THREE.Group();
          butterfly.add(leftWing, rightWing);
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
          for (const [x, y] of butterflyRects) {
            const cube = new THREE.Mesh(geometry, material);
            const cx = x - 8;
            cube.position.set(cx, 5.5 - y, 0);
            (cx < 0 ? leftWing : rightWing).add(cube);
          }
          scene.add(butterfly);

          const key = new THREE.DirectionalLight(0xffffff, 2.4);
          key.position.set(6, 8, 12);
          scene.add(key, new THREE.AmbientLight(0xffffff, 0.5));

          const effect = new AsciiEffect(renderer, " .:-=+*#%@", {
            invert: true,
            resolution: 0.15,
          });
          effect.setSize(width, height);
          const dom = effect.domElement;
          dom.style.color = "#a78bfa";
          dom.style.backgroundColor = "transparent";
          dom.style.cursor = "grab";
          dom.style.touchAction = "pan-y";
          if (fallbackRef.current) fallbackRef.current.style.display = "none";
          host.appendChild(dom);

          // Fit the mark to the container: scale down on narrow screens so
          // the wings never clip the frame — capped below 1 so the spread
          // wings plus the turntable's depth swing keep a margin from the
          // edges even at full flap.
          let scale = 1;
          const fit = (w: number, h: number) => {
            scale = Math.min(0.85, Math.max(0.55, (w / h) * 0.38));
            butterfly.scale.setScalar(scale);
          };
          fit(width, height);

          // Drag = the 360° view. Yaw carries on into the turntable from
          // wherever the user leaves it; pitch eases back level.
          let dragging = false;
          let userYaw = 0;
          let userPitch = 0;
          let start = { x: 0, y: 0, yaw: 0, pitch: 0 };
          const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            dragging = true;
            start = {
              x: e.clientX,
              y: e.clientY,
              yaw: userYaw,
              pitch: userPitch,
            };
            dom.style.cursor = "grabbing";
            try {
              dom.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic pointers can't be captured — drag still works.
            }
          };
          const onMove = (e: PointerEvent) => {
            if (!dragging) return;
            userYaw = start.yaw + (e.clientX - start.x) * 0.01;
            userPitch = Math.max(
              -1.2,
              Math.min(1.2, start.pitch + (e.clientY - start.y) * 0.007),
            );
            if (reduce) renderPose(0);
          };
          const onUp = () => {
            dragging = false;
            dom.style.cursor = "grab";
          };
          dom.addEventListener("pointerdown", onDown);
          dom.addEventListener("pointermove", onMove);
          dom.addEventListener("pointerup", onUp);
          dom.addEventListener("pointercancel", onUp);

          // Pose: stationary at center — wings flap, the body bobs against
          // the wingbeat, and a slow turntable shows off the depth.
          const clock = new THREE.Clock();
          let flapT = 0;
          let turnT = 0;
          const renderPose = (dt: number) => {
            flapT += dt;
            if (!dragging) {
              turnT += dt;
              const decay = Math.max(0, 1 - dt * 1.4);
              userPitch *= decay;
            }
            // Fold capped short of edge-on so the wings never dissolve
            // into a line of dashes at the top of the beat.
            const flap = 0.42 + Math.sin(flapT * 5.4) * 0.34;
            leftWing.rotation.y = flap;
            rightWing.rotation.y = -flap;
            butterfly.position.y =
              Math.sin(flapT * 5.4 + Math.PI / 2) * -0.35 * scale;
            butterfly.rotation.y = userYaw + turnT * 0.22;
            butterfly.rotation.x = userPitch - 0.18;
            effect.render(scene, camera);
          };

          // Render loop, paused offscreen and capped at ~30fps. Reduced
          // motion poses a single still frame and re-renders only on drag.
          let raf = 0;
          let acc = 0;
          const tick = () => {
            acc += Math.min(clock.getDelta(), 0.05);
            if (acc >= 1 / 30) {
              renderPose(acc);
              acc = 0;
            }
            raf = requestAnimationFrame(tick);
          };
          const visTrigger = ScrollTrigger.create({
            trigger: host,
            start: "top bottom",
            end: "bottom top",
            onToggle: (self) => {
              if (reduce) return;
              cancelAnimationFrame(raf);
              raf = 0;
              if (self.isActive) {
                clock.getDelta(); // swallow the offscreen gap
                raf = requestAnimationFrame(tick);
              }
            },
          });
          if (reduce) {
            renderPose(0);
          } else if (!raf) {
            raf = requestAnimationFrame(tick);
          }

          const ro = new ResizeObserver(() => {
            const w = host.clientWidth;
            const h = host.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            effect.setSize(w, h);
            fit(w, h);
            if (reduce) renderPose(0);
          });
          ro.observe(host);

          cleanup = () => {
            cancelAnimationFrame(raf);
            visTrigger.kill();
            ro.disconnect();
            dom.removeEventListener("pointerdown", onDown);
            dom.removeEventListener("pointermove", onMove);
            dom.removeEventListener("pointerup", onUp);
            dom.removeEventListener("pointercancel", onUp);
            dom.remove();
            geometry.dispose();
            material.dispose();
            renderer.dispose();
          };
        })();
      },
    });

    return () => {
      trigger.kill();
      cleanup?.();
    };
  }, []);

  return (
    <section className="bg-[#0e0e10] py-24 text-white sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/45">
          <span className="text-[#a78bfa]">07</span> · {eyebrow}
        </p>

        <MaskReveal
          as="h2"
          className="lp-display mt-6 max-w-4xl text-[clamp(2.2rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tight"
        >
          {heading}
        </MaskReveal>

        <div className="relative mt-14 border border-white/10">
          {/* lang="en" on purpose: the ASCII grid is language-neutral, and
           * under the page's lang="ja" the browser resolves AsciiEffect's
           * `courier new, monospace` through CJK font fallback — different
           * glyph metrics shear the whole tableau sideways. */}
          <div
            ref={hostRef}
            lang="en"
            aria-hidden="true"
            className="h-[340px] overflow-hidden select-none sm:h-[440px] [&>div]:mx-auto"
          >
            <pre
              ref={fallbackRef}
              className="lp-mono flex h-full items-center justify-center text-[9px] leading-[1.15] text-[#a78bfa] sm:text-[13px]"
            >
              {ASCII_FALLBACK}
            </pre>
          </div>
          <p className="lp-mono pointer-events-none absolute bottom-4 right-4 text-[11px] uppercase tracking-[0.2em] text-white/30">
            {hint}
          </p>
        </div>

        <p className="lp-sans mt-6 max-w-2xl text-sm leading-relaxed text-white/50">
          {caption}
        </p>
      </div>
    </section>
  );
}
