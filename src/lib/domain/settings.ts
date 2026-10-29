import { z } from "zod";

/** Per-business analysis configuration. Stored in businesses.settings (jsonb); missing keys fall back to defaults. */
export const businessSettingsSchema = z.object({
  analysis: z
    .object({
      demandLookbackDays: z.number().int().min(14).max(365).default(90),
      minHistoryDays: z.number().int().min(7).max(180).default(28),
      targetCoverageDays: z.number().int().min(1).max(180).default(30),
      defaultLeadTimeDays: z.number().int().min(0).max(180).default(7),
      defaultSafetyDays: z.number().min(0).max(60).default(3),
      slowMovingDays: z.number().int().min(14).max(365).default(90),
      slowVelocityPerMonth: z.number().min(0).max(1_000_000).default(1),
      excessCoverageDays: z.number().int().min(30).max(730).default(120),
      useTrendAdjustment: z.boolean().default(false),
    })
    .default({
      demandLookbackDays: 90,
      minHistoryDays: 28,
      targetCoverageDays: 30,
      defaultLeadTimeDays: 7,
      defaultSafetyDays: 3,
      slowMovingDays: 90,
      slowVelocityPerMonth: 1,
      excessCoverageDays: 120,
      useTrendAdjustment: false,
    }),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type AnalysisSettings = BusinessSettings["analysis"];

export function parseBusinessSettings(raw: unknown): BusinessSettings {
  const parsed = businessSettingsSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Fall back per-key: bad stored values never break the app.
  const analysis = (raw as { analysis?: Record<string, unknown> })?.analysis ?? {};
  const base = businessSettingsSchema.parse({});
  const merged = { ...base.analysis } as Record<string, unknown>;
  for (const [k, v] of Object.entries(analysis)) {
    const candidate = { analysis: { ...base.analysis, [k]: v } };
    if (businessSettingsSchema.safeParse(candidate).success) merged[k] = v;
  }
  return businessSettingsSchema.parse({ analysis: merged });
}
