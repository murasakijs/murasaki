"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { CopyCommand } from "@/components/copy-command";
import type { HomeContent } from "@/lib/home-content";

gsap.registerPlugin(ScrollTrigger);

/**
 * The finale: three commands, the closing claim, and a Matter.js pixel rain
 * — brand-colored pixel squares fall, pile, and can be picked up and tossed
 * (the physics runs in its own strip below the CTA so it never blocks the
 * buttons). The engine lazy-boots only when the section first scrolls into
 * view and is fully destroyed on unmount; reduced-motion gets a quiet
 * static pixel row instead.
 */

const PIXEL_COLORS = [
  "#7c3aed",
  "#7c3aed",
  "#a855f7",
  "#a855f7",
  "#5b21b6",
  "#5b21b6",
  "#faf5e8",
];

function PixelRain() {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cleanup: (() => void) | undefined;
    const trigger = ScrollTrigger.create({
      trigger: host,
      start: "top 95%",
      once: true,
      onEnter: () => {
        void (async () => {
          const Matter = (await import("matter-js")).default;
          if (!hostRef.current) return;
          const width = host.clientWidth;
          const height = host.clientHeight;

          const engine = Matter.Engine.create();
          const render = Matter.Render.create({
            element: host,
            engine,
            options: {
              width,
              height,
              wireframes: false,
              background: "transparent",
              pixelRatio: 1,
            },
          });

          const count = width < 640 ? 34 : 72;
          const squares = Array.from({ length: count }, () => {
            const size = gsap.utils.random([12, 16, 16, 20, 24]);
            return Matter.Bodies.rectangle(
              gsap.utils.random(size, width - size),
              gsap.utils.random(-height * 2.2, -size),
              size,
              size,
              {
                restitution: 0.15,
                friction: 0.6,
                render: {
                  fillStyle: gsap.utils.random(PIXEL_COLORS),
                },
              },
            );
          });

          const bounds = [
            Matter.Bodies.rectangle(width / 2, height + 30, width * 2, 60, {
              isStatic: true,
              render: { visible: false },
            }),
            Matter.Bodies.rectangle(-30, height / 2, 60, height * 6, {
              isStatic: true,
              render: { visible: false },
            }),
            Matter.Bodies.rectangle(width + 30, height / 2, 60, height * 6, {
              isStatic: true,
              render: { visible: false },
            }),
          ];

          // Pick-up-and-toss. Matter's mouse grabs the wheel/touch events it
          // finds on the canvas — release them so the page keeps scrolling.
          const mouse = Matter.Mouse.create(render.canvas);
          const mouseConstraint = Matter.MouseConstraint.create(engine, {
            mouse,
            constraint: { stiffness: 0.2, render: { visible: false } },
          });
          const mouseTarget = mouse.element as HTMLElement;
          // biome-ignore lint/suspicious/noExplicitAny: Matter's internal handler refs aren't typed.
          const anyMouse = mouse as any;
          mouseTarget.removeEventListener("wheel", anyMouse.mousewheel);
          mouseTarget.removeEventListener("touchmove", anyMouse.mousemove);
          mouseTarget.removeEventListener("touchstart", anyMouse.mousedown);
          mouseTarget.removeEventListener("touchend", anyMouse.mouseup);

          Matter.Composite.add(engine.world, [
            ...squares,
            ...bounds,
            mouseConstraint,
          ]);

          const runner = Matter.Runner.create();
          Matter.Runner.run(runner, engine);
          Matter.Render.run(render);

          cleanup = () => {
            Matter.Render.stop(render);
            Matter.Runner.stop(runner);
            Matter.Composite.clear(engine.world, false);
            Matter.Engine.clear(engine);
            render.canvas.remove();
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
    <div
      ref={hostRef}
      aria-hidden="true"
      className="relative h-[30vh] min-h-44 w-full cursor-grab active:cursor-grabbing [&_canvas]:absolute [&_canvas]:inset-0"
    />
  );
}

export function PxCta({
  quickstart,
  heading,
  paragraph,
  installCommand,
  getStartedLabel,
  getStartedHref,
  githubLabel,
  githubHref,
}: {
  quickstart: HomeContent["quickStart"];
  heading: string;
  paragraph: string;
  installCommand: string;
  getStartedLabel: string;
  getStartedHref: string;
  githubLabel: string;
  githubHref: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const words = /\s/.test(heading) ? heading.split(/\s+/) : [heading];

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const ctx = gsap.context(() => {
        gsap.from("[data-cta-step]", {
          opacity: 0,
          x: -24,
          duration: 0.55,
          ease: "power2.out",
          stagger: 0.08,
          scrollTrigger: { trigger: "[data-cta-steps]", start: "top 85%" },
        });
        gsap.from("[data-cta-word]", {
          yPercent: 112,
          duration: 0.8,
          ease: "expo.out",
          stagger: 0.06,
          scrollTrigger: { trigger: "[data-cta-h]", start: "top 80%" },
        });
        gsap.from("[data-cta-rest]", {
          opacity: 0,
          y: 20,
          duration: 0.7,
          ease: "power2.out",
          delay: 0.3,
          scrollTrigger: { trigger: "[data-cta-h]", start: "top 80%" },
        });
      }, root);
      return () => ctx.revert();
    });
    return () => mm.revert();
  }, []);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden bg-[#0e0e10] pt-24 text-white sm:pt-32"
    >
      <span
        aria-hidden="true"
        className="lp-kanji pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 select-none text-[76vw] font-bold leading-none text-white/[0.04] sm:text-[42vw]"
      >
        紫
      </span>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6">
        {/* Three commands. */}
        <p className="lp-pixel text-[11px] uppercase tracking-[0.25em] text-white/45">
          <span className="text-[#a78bfa]">07</span> · {quickstart.eyebrow}
        </p>
        <div data-cta-steps className="mt-8 border-t border-white/12">
          {quickstart.steps.map((step, i) => (
            <div
              key={step.command}
              data-cta-step
              className="flex flex-col gap-1.5 border-b border-white/12 py-5 sm:flex-row sm:items-baseline sm:gap-8"
            >
              <span className="lp-pixel flex items-baseline gap-3 text-[10px] uppercase tracking-[0.25em] text-white/45 sm:w-36 sm:shrink-0">
                <span aria-hidden="true" className="text-[#a78bfa]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step.label}
              </span>
              <code className="lp-mono block overflow-x-auto text-[clamp(0.95rem,2.2vw,1.4rem)] font-medium tracking-tight whitespace-pre">
                <span aria-hidden="true" className="select-none text-[#a78bfa]">
                  ${" "}
                </span>
                {step.command}
              </code>
            </div>
          ))}
        </div>

        {/* The closing claim. */}
        <div className="mx-auto mt-24 flex max-w-5xl flex-col items-center text-center sm:mt-32">
          <h2
            data-cta-h
            className="lp-display flex flex-wrap justify-center gap-x-[0.28em] text-[clamp(2.6rem,8vw,6.5rem)] font-extrabold leading-[0.95] tracking-tight"
          >
            {words.map((word, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static heading.
                key={i}
                className="inline-block overflow-hidden"
              >
                <span
                  data-cta-word
                  className="inline-block will-change-transform"
                >
                  {word}
                </span>
              </span>
            ))}
          </h2>

          <div data-cta-rest className="flex flex-col items-center">
            <p className="lp-sans mt-6 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
              {paragraph}
            </p>
            <div className="mt-10 flex flex-col items-center gap-5">
              <CopyCommand command={installCommand} />
              <div className="flex items-center gap-3">
                <Link
                  href={getStartedHref}
                  className="lp-sans group inline-flex h-12 items-center gap-2 bg-[#7c3aed] px-7 font-semibold text-white transition-colors hover:bg-[#6d28d9]"
                >
                  {getStartedLabel}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href={githubHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-sans inline-flex h-12 items-center border border-white/25 px-7 font-semibold text-white/90 transition-colors hover:border-white/55"
                >
                  {githubLabel}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The pixel rain floor. */}
      <PixelRain />
    </section>
  );
}
