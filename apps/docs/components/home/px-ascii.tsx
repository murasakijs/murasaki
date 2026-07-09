"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";
import { butterflyRects } from "@/lib/butterfly-rects";
import type { LpExtra } from "@/lib/home-content";
import { MaskReveal } from "./lp-motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * The living ASCII aviary. The brand mark's 17×12 pixel grid
 * (butterfly-rects.ts) is extruded into voxels — one cube per pixel, split
 * into two wing groups that flap around the body axis. The hero butterfly
 * carries the mark's real three colors and patrols the frame in all three
 * axes (the z wander is what makes it swell and shrink with perspective),
 * escorted by a few smaller, differently-colored companions on their own
 * paths. Everything renders as per-character colored text via three.js
 * AsciiEffect's color mode. Dragging freezes the flight and gives a free
 * 360° inspection of the hero; release eases it back into the patrol.
 *
 * three.js is heavy, so it lazy-loads exactly like the CTA's Matter.js:
 * a once ScrollTrigger dynamic-imports it when the section approaches.
 * Until then — and forever, for no-JS / no-WebGL visitors — a static ASCII
 * butterfly derived from the same pixel data holds the frame.
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

/** Voxel colors per butterfly: the mark's upper-wing / lower-wing / accent
 * fills remapped. The hero keeps the true brand colors. */
type Wardrobe = { upper: number; lower: number; accent: number };
const HERO: Wardrobe = { upper: 0xa855f7, lower: 0x5b21b6, accent: 0xfaf5e8 };
/** Companion flight plans. Each keeps its own territory (`ox`/`oy` shift
 * the roam center, in frustum-halves) far from the hero's center stage,
 * and their amplitudes deliberately overshoot the frame — |ox| + ax > 1
 * means they wander OUT of view and come back, which reads as a real
 * garden rather than an enclosure. `oz`/`rz` bias them behind the hero. */
const COMPANIONS: {
  wardrobe: Wardrobe;
  scale: number;
  flapSpeed: number;
  fx: number;
  fy: number;
  fz: number;
  px0: number;
  py0: number;
  pz0: number;
  ox: number;
  oy: number;
  oz: number;
  ax: number;
  ay: number;
  rz: number;
}[] = [
  // z bands are strictly separated from the hero's (±6) so nobody ever
  // crosses in FRONT of it and scrambles the tableau, and x amplitudes are
  // kept to each one's own half of the frame (c3 may cross, but only deep
  // in the background where it reads as parallax).
  {
    wardrobe: { upper: 0xd946ef, lower: 0xa21caf, accent: 0xfaf5e8 },
    scale: 0.42,
    flapSpeed: 7.6,
    fx: 0.23,
    fy: 0.41,
    fz: 0.19,
    px0: 2.1,
    py0: 0.4,
    pz0: 3.4,
    ox: 0.75,
    oy: -0.3,
    oz: -9,
    ax: 0.4,
    ay: 0.5,
    rz: 2.5,
  },
  {
    wardrobe: { upper: 0x8b5cf6, lower: 0x4c1d95, accent: 0xfaf5e8 },
    scale: 0.34,
    flapSpeed: 8.8,
    fx: 0.37,
    fy: 0.29,
    fz: 0.31,
    px0: 4.4,
    py0: 2.6,
    pz0: 1.2,
    ox: -0.7,
    oy: 0.5,
    oz: -11,
    ax: 0.45,
    ay: 0.6,
    rz: 2.5,
  },
  {
    wardrobe: { upper: 0xfaf5e8, lower: 0xc4b5fd, accent: 0x7c3aed },
    scale: 0.27,
    flapSpeed: 9.7,
    fx: 0.29,
    fy: 0.53,
    fz: 0.23,
    px0: 5.8,
    py0: 4.9,
    pz0: 5.1,
    ox: 0.2,
    oy: 0.75,
    oz: -14,
    ax: 1.1,
    ay: 0.45,
    rz: 2,
  },
];

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

          const CAM_Z = 26;
          const camera = new THREE.PerspectiveCamera(
            40,
            width / height,
            1,
            100,
          );
          camera.position.z = CAM_Z;
          const tanHalf = Math.tan((camera.fov * Math.PI) / 360);

          // Everything lives in one world group; dragging rotates the whole
          // diorama, so the 360° view covers the companions too.
          const world = new THREE.Group();
          scene.add(world);

          // Voxelize the mark into a body-axis rig: every pixel becomes a
          // cube parented to its wing's group (the mark has no x=8 column —
          // that gap IS the body line), so the wings flap by rotating
          // around Y. One material per fill color per butterfly.
          const geometry = new THREE.BoxGeometry(1, 1, 1);
          const materials: InstanceType<typeof THREE.MeshStandardMaterial>[] =
            [];
          const makeButterfly = (wardrobe: Wardrobe) => {
            const root = new THREE.Group();
            const left = new THREE.Group();
            const right = new THREE.Group();
            root.add(left, right);
            const byFill = new Map<
              string,
              InstanceType<typeof THREE.MeshStandardMaterial>
            >();
            for (const [x, y, fill] of butterflyRects) {
              let mat = byFill.get(fill);
              if (!mat) {
                const color =
                  fill === "#5B21B6"
                    ? wardrobe.lower
                    : fill === "#FAF5E8"
                      ? wardrobe.accent
                      : wardrobe.upper;
                mat = new THREE.MeshStandardMaterial({ color });
                byFill.set(fill, mat);
                materials.push(mat);
              }
              const cube = new THREE.Mesh(geometry, mat);
              const cx = x - 8;
              cube.position.set(cx, 5.5 - y, 0);
              (cx < 0 ? left : right).add(cube);
            }
            world.add(root);
            return { root, left, right };
          };

          const hero = makeButterfly(HERO);
          const flock = COMPANIONS.map((c) => ({
            ...c,
            rig: makeButterfly(c.wardrobe),
          }));

          const key = new THREE.DirectionalLight(0xffffff, 2.6);
          key.position.set(6, 8, 14);
          scene.add(key, new THREE.AmbientLight(0xffffff, 0.65));

          // Color mode: every character gets its own colored span, which is
          // what lets the companions actually wear different colors. It's
          // costlier than monochrome, so the resolution is a notch lower.
          // `invert` matters even in color mode: the base mapping sends
          // zero luminance to the DENSEST glyph, so without it the black
          // background renders as a field of dark "@" texture.
          const effect = new AsciiEffect(renderer, " .:-=+*#%@", {
            color: true,
            invert: true,
            resolution: 0.12,
          });
          effect.setSize(width, height);
          const dom = effect.domElement;
          dom.style.backgroundColor = "transparent";
          dom.style.cursor = "grab";
          dom.style.touchAction = "pan-y";
          if (fallbackRef.current) fallbackRef.current.style.display = "none";
          host.appendChild(dom);

          // The hero's on-screen size scales with the container aspect so
          // phones aren't wall-to-wall butterfly.
          let aspect = width / height;
          let heroScale = 1;
          const computeBounds = (w: number, h: number) => {
            aspect = w / h;
            heroScale = Math.min(1, Math.max(0.6, aspect * 0.42));
            hero.root.scale.setScalar(heroScale);
            for (const c of flock)
              c.rig.root.scale.setScalar(heroScale * c.scale);
          };
          computeBounds(width, height);

          // Drag = free 360° inspection of the hero. The flight clock
          // freezes (everyone hovers, still flapping) and the inspection
          // rotation eases away after release.
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

          // Flight. Every butterfly rides its own 3-axis Lissajous wander;
          // the z leg is what sells the perspective (bigger as it nears the
          // camera). The hero stays clamped inside the frustum at its
          // current depth — it's the drag-inspection subject — while
          // companions may overshoot the frame and wander back in.
          const clock = new THREE.Clock();
          let flapT = 0;
          let flightT = 0;
          type Rig = {
            root: InstanceType<typeof THREE.Group>;
            left: InstanceType<typeof THREE.Group>;
            right: InstanceType<typeof THREE.Group>;
          };
          const flapWings = (
            r: Rig,
            flapSpeed: number,
            flapPhase: number,
          ): number => {
            // Fold capped short of edge-on so the wings never dissolve into
            // a line of dashes at the top of the beat.
            const flap = 0.42 + Math.sin(flapT * flapSpeed + flapPhase) * 0.34;
            r.left.rotation.y = flap;
            r.right.rotation.y = -flap;
            // The body bobs against the wingbeat.
            return (
              Math.sin(flapT * flapSpeed + flapPhase + Math.PI / 2) * -0.35
            );
          };
          const place = (
            r: Rig,
            px: number,
            py: number,
            pz: number,
            vx: number,
            yawExtra: number,
            pitchExtra: number,
          ) => {
            r.root.position.set(px, py, pz);
            r.root.rotation.y =
              yawExtra + Math.max(-0.55, Math.min(0.55, vx * 0.35));
            r.root.rotation.x = pitchExtra - 0.22;
            r.root.rotation.z = Math.max(-0.3, Math.min(0.3, -vx * 0.12));
          };

          const renderPose = (dt: number) => {
            flapT += dt;
            if (!dragging) {
              flightT += dt;
              // Ease the inspection rotation back into the patrol pose.
              const decay = Math.max(0, 1 - dt * 1.6);
              userYaw *= decay;
              userPitch *= decay;
            }

            // Drag rotates the whole diorama — hero AND companions.
            world.rotation.y = userYaw;
            world.rotation.x = userPitch;

            // Hero: center stage, kept fully in frame.
            {
              const bob = flapWings(hero, 5.4, 0) * heroScale;
              const pz = Math.sin(flightT * 0.29 + 0.8) * 6;
              const dist = CAM_Z - pz;
              const halfH = tanHalf * dist;
              const halfW = halfH * aspect;
              const mx = Math.max(0.3, halfW - 11 * heroScale);
              const my = Math.max(0.3, halfH - 7.5 * heroScale);
              const px = Math.sin(flightT * 0.44) * mx;
              const py = Math.sin(flightT * 0.63 + 1.4) * my + bob;
              const vx = Math.cos(flightT * 0.44) * 0.44 * mx;
              place(hero, px, py, pz, vx, 0, 0);
            }

            // Companions: each on its own territory, allowed out of frame.
            for (const c of flock) {
              const s = heroScale * c.scale;
              const bob = flapWings(c.rig, c.flapSpeed, c.px0) * s;
              const pz = c.oz + Math.sin(flightT * c.fz + c.pz0) * c.rz;
              const dist = CAM_Z - pz;
              const halfH = tanHalf * dist;
              const halfW = halfH * aspect;
              const px =
                (c.ox + Math.sin(flightT * c.fx + c.px0) * c.ax) * halfW;
              const py =
                (c.oy + Math.sin(flightT * c.fy + c.py0) * c.ay) * halfH + bob;
              const vx = Math.cos(flightT * c.fx + c.px0) * c.fx * c.ax * halfW;
              place(c.rig, px, py, pz, vx, 0, 0);
            }

            effect.render(scene, camera);
          };

          // Render loop, paused offscreen and capped at ~30fps — every
          // ASCII frame rebuilds thousands of colored spans, so halving the
          // update rate halves the DOM churn without hurting the floaty
          // motion. Reduced motion poses a single still frame and
          // re-renders only on drag.
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
            computeBounds(w, h);
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
            for (const m of materials) m.dispose();
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
