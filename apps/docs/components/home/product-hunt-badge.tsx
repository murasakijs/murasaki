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

/** Official Product Hunt card, shared by the launch hero and site footer. */
export function ProductHuntBadge({
  lang,
  accent = false,
  lazy = false,
  className,
}: ProductHuntBadgeProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const updateTimer = () => {
      setNowMs(Date.now());
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, []);

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
    <span className={`inline-flex max-w-full pt-10 ${className ?? ""}`}>
      <span className="flex items-center gap-3">
        {accent ? (
          <span
            aria-hidden="true"
            className="hidden h-[54px] w-1 shrink-0 bg-[#7c3aed] sm:block"
          />
        ) : null}

        <span className="relative inline-flex max-w-full">
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
      </span>
    </span>
  );
}
