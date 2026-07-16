"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const PRODUCT_HUNT_BADGES = {
  follow: {
    href: "https://www.producthunt.com/products/murasaki?utm_source=badge-follow&utm_medium=badge&utm_source=badge-murasaki",
    image:
      "https://api.producthunt.com/widgets/embed-image/v1/follow.svg?product_id=1269936&theme=light",
    label: "Follow Murasaki on Product Hunt",
  },
  review: {
    href: "https://www.producthunt.com/products/murasaki/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_source=badge-murasaki",
    image:
      "https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1269936&theme=light",
    label: "Review Murasaki on Product Hunt",
  },
} as const;

const PRODUCT_HUNT_LAUNCH_AT = new Date("2026-07-16T00:01:00-07:00").getTime();

interface ProductHuntBadgeProps {
  lang: string;
  variant?: keyof typeof PRODUCT_HUNT_BADGES;
  showLaunchTimer?: boolean;
  accent?: boolean;
  lazy?: boolean;
  className?: string;
}

function formatDuration(durationMs: number, round: "ceil" | "floor") {
  const roundSeconds = round === "ceil" ? Math.ceil : Math.floor;
  const totalSeconds = Math.max(0, roundSeconds(durationMs / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(" : ");
}

/** Official Product Hunt follow/review cards used by the hero and footer. */
export function ProductHuntBadge({
  lang,
  variant = "follow",
  showLaunchTimer = false,
  accent = false,
  lazy = false,
  className,
}: ProductHuntBadgeProps) {
  const badge = PRODUCT_HUNT_BADGES[variant];
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!showLaunchTimer) return;

    const updateTimer = () => {
      setNowMs(Date.now());
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [showLaunchTimer]);

  const isLocked = nowMs === null || nowMs < PRODUCT_HUNT_LAUNCH_AT;
  const timerValue =
    nowMs === null
      ? "-- : -- : --"
      : isLocked
        ? formatDuration(PRODUCT_HUNT_LAUNCH_AT - nowMs, "ceil")
        : `+ ${formatDuration(nowMs - PRODUCT_HUNT_LAUNCH_AT, "floor")}`;
  const timerLabel = isLocked
    ? lang === "ja"
      ? `Product Hunt 公開まで ${timerValue}`
      : `Product Hunt launch in ${timerValue}`
    : lang === "ja"
      ? `Product Hunt 公開中 ${timerValue}`
      : `Product Hunt live ${timerValue}`;
  const image = (
    <Image
      src={badge.image}
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
      className={`inline-flex max-w-full ${showLaunchTimer ? "pt-10" : ""} ${className ?? ""}`}
    >
      <span className="flex items-center gap-3">
        {accent ? (
          <span
            aria-hidden="true"
            className="hidden h-[54px] w-1 shrink-0 bg-[#7c3aed] md:block"
          />
        ) : null}

        <span className="relative inline-flex max-w-full">
          {showLaunchTimer ? (
            <span
              role="timer"
              aria-label={timerLabel}
              className="lp-pixel absolute bottom-[calc(100%+10px)] left-1/2 z-10 flex w-[184px] -translate-x-1/2 items-center justify-center whitespace-nowrap bg-[#111014] px-3 py-2 text-[9px] tracking-[0.12em] text-white uppercase shadow-lg after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-x-[6px] after:border-t-[6px] after:border-x-transparent after:border-t-[#111014]"
            >
              {isLocked
                ? lang === "ja"
                  ? "公開まで"
                  : "Launch in"
                : lang === "ja"
                  ? "公開中"
                  : "Live"}{" "}
              <time
                dateTime="2026-07-16T00:01:00-07:00"
                className="inline-block w-24 shrink-0 text-center tabular-nums"
              >
                {timerValue}
              </time>
            </span>
          ) : null}

          {showLaunchTimer && isLocked ? (
            <span
              aria-disabled="true"
              className="inline-flex max-w-full cursor-not-allowed opacity-45 grayscale-[0.15]"
            >
              {image}
            </span>
          ) : (
            <a
              href={badge.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={badge.label}
              className="inline-flex max-w-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7c3aed]"
            >
              {image}
            </a>
          )}
        </span>
      </span>
    </span>
  );
}
