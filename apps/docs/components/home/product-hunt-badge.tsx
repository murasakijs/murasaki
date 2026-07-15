"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const PRODUCT_HUNT_URL =
  "https://www.producthunt.com/products/murasaki?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-murasaki";

const PRODUCT_HUNT_BADGE_URL =
  "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1196791&theme=neutral&t=1784129201283";

const PRODUCT_HUNT_LAUNCH_AT = new Date("2026-07-16T00:01:00-07:00").getTime();

interface ProductHuntBadgeProps {
  lang: string;
  lazy?: boolean;
  className?: string;
}

function formatCountdown(remainingMs: number | null) {
  if (remainingMs === null) return "-- : -- : --";

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(" : ");
}

/** Official Product Hunt card, shared by the launch hero and site footer. */
export function ProductHuntBadge({
  lang,
  lazy = false,
  className,
}: ProductHuntBadgeProps) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const updateCountdown = () => {
      setRemainingMs(Math.max(0, PRODUCT_HUNT_LAUNCH_AT - Date.now()));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const isLocked = remainingMs === null || remainingMs > 0;
  const image = (
    <Image
      src={PRODUCT_HUNT_BADGE_URL}
      alt="Murasaki - Next.js DX for native desktop apps | Product Hunt"
      width={250}
      height={54}
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      className="block h-[54px] w-[250px] max-w-full"
    />
  );

  return (
    <span
      className={`relative inline-flex max-w-full ${isLocked ? "pt-10" : ""} ${className ?? ""}`}
    >
      {isLocked ? (
        <span
          role="timer"
          aria-label={
            lang === "ja"
              ? `Product Hunt 公開まで ${formatCountdown(remainingMs)}`
              : `Product Hunt launch in ${formatCountdown(remainingMs)}`
          }
          className="lp-pixel absolute top-0 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap bg-[#111014] px-3 py-2 text-[9px] tracking-[0.12em] text-white uppercase shadow-lg after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-x-[6px] after:border-t-[6px] after:border-x-transparent after:border-t-[#111014]"
        >
          {lang === "ja" ? "公開まで" : "Launch in"}{" "}
          <time dateTime="2026-07-16T00:01:00-07:00">
            {formatCountdown(remainingMs)}
          </time>
        </span>
      ) : null}

      {isLocked ? (
        <span
          aria-disabled="true"
          className="inline-flex max-w-full cursor-not-allowed opacity-45 grayscale-[0.15]"
        >
          {image}
        </span>
      ) : (
        <a
          href={PRODUCT_HUNT_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View Murasaki on Product Hunt"
          className="inline-flex max-w-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7c3aed]"
        >
          {image}
        </a>
      )}
    </span>
  );
}
