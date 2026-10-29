import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StockPilot AI — inventory intelligence for Indian traders", template: "%s · StockPilot AI" },
  description:
    "Import your billing exports and see what to reorder, what is not selling, and how much money is tied up in stock. Built for Indian wholesalers, distributors and spare-parts dealers.",
  applicationName: "StockPilot AI",
};

export const viewport: Viewport = {
  themeColor: "#10233f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="min-h-full bg-paper text-text">{children}</body>
    </html>
  );
}
