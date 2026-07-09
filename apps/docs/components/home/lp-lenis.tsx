"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Buttery inertia scroll for the landing page only — the single biggest
 * "expensive site" feel multiplier (the Lenis/Locomotive lineage every
 * award-tier page rides on). Mounted by the LP root, destroyed on unmount,
 * so docs pages keep native scrolling. Lenis smooths native window scroll,
 * so motion's `useScroll`-driven pieces keep working unchanged. Disabled
 * entirely under prefers-reduced-motion.
 */
export function LpLenis() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const lenis = new Lenis({ autoRaf: true, lerp: 0.12 });
    return () => lenis.destroy();
  }, []);

  return null;
}
