import "server-only";
import { z } from "zod";
import { withAdmin } from "@/lib/db";
import type { PlanFeatures, PlanLimits } from "./entitlements";

export type PublicPlan = {
  code: string;
  name: string;
  priceInrMonthly: number | null;
  isCustomPrice: boolean;
  description: string;
  limits: PlanLimits;
  features: PlanFeatures;
};

/** Plans marked public, read from the database so prices/limits are configured server-side in one place. */
export async function getPublicPlans(): Promise<PublicPlan[]> {
  const rows = await withAdmin((tx) =>
    tx.query<{ code: string; name: string; price_inr_monthly: string | null; is_custom_price: boolean; description: string; limits: PlanLimits; features: PlanFeatures }>(
      "SELECT code, name, price_inr_monthly, is_custom_price, description, limits, features FROM plans WHERE is_public ORDER BY sort_order",
    ),
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    priceInrMonthly: r.price_inr_monthly === null ? null : Number(r.price_inr_monthly),
    isCustomPrice: r.is_custom_price,
    description: r.description,
    limits: r.limits,
    features: r.features,
  }));
}

export const demoRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
  company: z.string().trim().max(160).optional().transform((v) => v || null),
  city: z.string().trim().max(80).optional().transform((v) => v || null),
  industry: z.string().trim().max(40).optional().transform((v) => v || null),
  message: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function saveDemoRequest(input: unknown) {
  const d = demoRequestSchema.parse(input);
  await withAdmin((tx) =>
    tx.query("INSERT INTO demo_requests (name, email, phone, company, city, industry, message) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
      d.name, d.email, d.phone, d.company, d.city, d.industry, d.message,
    ]),
  );
}
