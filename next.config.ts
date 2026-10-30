import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Cache Components is intentionally off: nearly every page is per-tenant and per-request.
  poweredByHeader: false,
  // Docker/self-hosting builds a minimal standalone server (NEXT_OUTPUT=standalone); Vercel ignores this.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  serverExternalPackages: ["@node-rs/argon2", "pdfkit", "exceljs", "unpdf", "pg"],
  // PDF fonts are read from disk at runtime; make sure they are traced into serverless bundles.
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  // Dynamic file paths (storage, migrations) make the tracer pull in the whole repo; keep the server bundle lean.
  outputFileTracingExcludes: { "/**": ["./android/**", "./tests/**", "./mobile/**", "./docs/**", "./src/**/*.tsx", "./.data/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
