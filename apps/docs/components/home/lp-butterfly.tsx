"use client";

import {
  m,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

/**
 * The living mascot — ONE butterfly for the whole page. It draws itself in
 * at its hero perch (stroke `pathLength` 0→1, then the fill fades up),
 * flutters forever (wing groups scale toward the body axis), and flies a
 * scroll-linked path down the page (fixed-positioned; x/y/rotate mapped from
 * smoothed page scroll progress). Purely decorative: `aria-hidden`,
 * `pointer-events-none`, and reduced-motion renders it perched and still.
 */

// Flight path — viewport-relative stops swept by page scroll progress.
const STOPS = [0, 0.18, 0.38, 0.58, 0.78, 1];
const X_STOPS = ["68vw", "10vw", "74vw", "9vw", "60vw", "44vw"];
const Y_STOPS = ["18vh", "56vh", "32vh", "58vh", "26vh", "66vh"];
const ROT_STOPS = [-8, 12, -14, 10, -6, 2];
const SCALE_STOPS = [1, 0.82, 0.9, 0.78, 0.88, 1.05];

const WING_TRANSITION = {
  duration: 1.5,
  repeat: Number.POSITIVE_INFINITY,
  ease: "easeInOut" as const,
};

function Wings({ animate }: { animate: boolean }) {
  const draw = {
    initial: { pathLength: 0, fillOpacity: 0, strokeOpacity: 0.9 },
    animate: {
      pathLength: 1,
      fillOpacity: 1,
      transition: {
        pathLength: { duration: 1.4, ease: "easeInOut" as const },
        fillOpacity: { duration: 0.9, delay: 0.8 },
      },
    },
  };

  return (
    <svg
      viewBox="0 0 200 160"
      className="h-auto w-full drop-shadow-[0_0_22px_rgba(168,85,247,0.45)]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lp-fore" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="lp-hind" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#5b21b6" />
        </linearGradient>
      </defs>

      {/* Left wing pair — flaps toward the body axis. */}
      <m.g
        style={{ transformBox: "fill-box", transformOrigin: "100% 50%" }}
        animate={animate ? { scaleX: [1, 0.42, 1] } : undefined}
        transition={WING_TRANSITION}
      >
        <m.path
          d="M96,62 C70,30 22,22 12,44 C4,62 40,84 94,74 Z"
          fill="url(#lp-fore)"
          stroke="#e9d5ff"
          strokeWidth="1.5"
          variants={draw}
          initial="initial"
          animate="animate"
        />
        <m.path
          d="M94,80 C58,82 30,102 42,124 C52,140 84,122 97,92 Z"
          fill="url(#lp-hind)"
          stroke="#e9d5ff"
          strokeWidth="1.5"
          variants={draw}
          initial="initial"
          animate="animate"
        />
      </m.g>

      {/* Right wing pair (mirrored). */}
      <m.g
        style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
        animate={animate ? { scaleX: [1, 0.42, 1] } : undefined}
        transition={{ ...WING_TRANSITION, delay: 0.06 }}
      >
        <m.path
          d="M104,62 C130,30 178,22 188,44 C196,62 160,84 106,74 Z"
          fill="url(#lp-fore)"
          stroke="#e9d5ff"
          strokeWidth="1.5"
          variants={draw}
          initial="initial"
          animate="animate"
        />
        <m.path
          d="M106,80 C142,82 170,102 158,124 C148,140 116,122 103,92 Z"
          fill="url(#lp-hind)"
          stroke="#e9d5ff"
          strokeWidth="1.5"
          variants={draw}
          initial="initial"
          animate="animate"
        />
      </m.g>

      {/* Body + antennae. */}
      <m.path
        d="M100,50 C97,70 97,95 100,118"
        fill="none"
        stroke="#f5f3ff"
        strokeWidth="5"
        strokeLinecap="round"
        variants={draw}
        initial="initial"
        animate="animate"
      />
      <circle cx="100" cy="44" r="6" fill="#f5f3ff" />
      <m.path
        d="M96,40 C88,26 76,20 66,22 M104,40 C112,26 124,20 134,22"
        fill="none"
        stroke="#e9d5ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        variants={draw}
        initial="initial"
        animate="animate"
      />
    </svg>
  );
}

export function LpButterfly() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 60,
    damping: 20,
    restDelta: 0.001,
  });
  const x = useTransform(progress, STOPS, X_STOPS);
  const y = useTransform(progress, STOPS, Y_STOPS);
  const rotate = useTransform(progress, STOPS, ROT_STOPS);
  const scale = useTransform(progress, STOPS, SCALE_STOPS);

  if (reduce) {
    // Perched and still — no flight, no flutter, no draw-in choreography.
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-[68vw] top-[18vh] z-30 w-16 opacity-90 sm:w-20 md:w-28"
      >
        <Wings animate={false} />
      </div>
    );
  }

  return (
    <m.div
      aria-hidden="true"
      style={{ x, y, rotate, scale }}
      className="pointer-events-none fixed left-0 top-0 z-30 w-16 will-change-transform sm:w-20 md:w-28"
    >
      {/* Gentle idle bob layered under the scroll flight. */}
      <m.div
        animate={{ y: [0, -7, 0] }}
        transition={{
          duration: 3.4,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <Wings animate />
      </m.div>
    </m.div>
  );
}
