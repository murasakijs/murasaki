import Image from "next/image";

const PRODUCT_HUNT_URL =
  "https://www.producthunt.com/products/murasaki?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-murasaki";

const PRODUCT_HUNT_BADGE_URL =
  "https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1196791&theme=neutral&t=1784129201283";

interface ProductHuntBadgeProps {
  lazy?: boolean;
  className?: string;
}

/** Official Product Hunt card, shared by the launch hero and site footer. */
export function ProductHuntBadge({
  lazy = false,
  className,
}: ProductHuntBadgeProps) {
  return (
    <a
      href={PRODUCT_HUNT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View Murasaki on Product Hunt"
      className={`inline-flex max-w-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7c3aed] ${className ?? ""}`}
    >
      <Image
        src={PRODUCT_HUNT_BADGE_URL}
        alt="Murasaki - Next.js DX for native desktop apps | Product Hunt"
        width={250}
        height={54}
        loading={lazy ? "lazy" : "eager"}
        decoding="async"
        className="block h-[54px] w-[250px] max-w-full"
      />
    </a>
  );
}
