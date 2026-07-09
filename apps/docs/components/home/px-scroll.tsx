"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

/**
 * The landing page's scroll engine: Lenis inertia scroll driven by GSAP's
 * ticker, with ScrollTrigger kept in sync — the standard award-site recipe
 * (Lenis owns the scroll feel, ScrollTrigger owns the choreography).
 *
 * Registered/mounted once by the LP root and destroyed on unmount so docs
 * pages keep native scrolling. Under prefers-reduced-motion Lenis is
 * skipped entirely; individual GSAP animations opt out via
 * `gsap.matchMedia()` in their own components.
 */
gsap.registerPlugin(ScrollTrigger);

export function PxScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const lenis = new Lenis({ lerp: 0.12 });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return null;
}
