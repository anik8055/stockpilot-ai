import Link from "next/link";
import { Logo } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { MobileNav } from "./mobile-nav";

const NAV = [
  { href: "/features/inventory-intelligence", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-muted hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <LinkButton href="/login" variant="ghost">
              Sign in
            </LinkButton>
            <LinkButton href="/signup">Start free trial</LinkButton>
          </div>
          <MobileNav items={NAV} />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-paper">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 md:grid-cols-4">
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-muted">Inventory intelligence for Indian wholesalers, distributors and spare-parts dealers.</p>
          </div>
          <FooterCol
            title="Product"
            links={[
              ["/features/inventory-intelligence", "Inventory intelligence"],
              ["/features/purchase-planning", "Purchase planning"],
              ["/features/invoice-extraction", "Invoice extraction"],
              ["/features/reporting", "Weekly reports"],
            ]}
          />
          <FooterCol title="Company" links={[["/how-it-works", "How it works"], ["/pricing", "Pricing"], ["/contact", "Contact & demo"]]} />
          <FooterCol title="Legal" links={[["/privacy", "Privacy & data"], ["/terms", "Terms of use"]]} />
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-faint sm:px-6">Prices shown are indicative and exclude GST.</p>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 font-semibold text-ink">{title}</p>
      <ul className="space-y-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-muted hover:text-ink">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
