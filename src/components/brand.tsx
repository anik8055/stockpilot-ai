import Link from "next/link";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <rect x="14" y="36" width="9" height="14" rx="2" fill="#8fb3ee" />
      <rect x="27.5" y="27" width="9" height="23" rx="2" fill="#c9daf7" />
      <rect x="41" y="17" width="9" height="33" rx="2" fill="#ffffff" />
    </svg>
  );
}

export function Logo({ href = "/", inverted = false }: { href?: string; inverted?: boolean }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 font-semibold tracking-tight ${inverted ? "text-white" : "text-ink"}`}>
      <span className={inverted ? "text-ink-3" : "text-ink"}>
        <LogoMark />
      </span>
      <span className="text-[1.05rem]">
        StockPilot<span className={inverted ? "text-[#8fb3ee]" : "text-signal"}> AI</span>
      </span>
    </Link>
  );
}
