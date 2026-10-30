import "server-only";
import { z } from "zod";

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL (app role, no BYPASSRLS) is required"),
  DATABASE_ADMIN_URL: z.string().min(1, "DATABASE_ADMIN_URL (owner role) is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./.data/storage"),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,

  AI_PROVIDER: z.enum(["none", "groq", "openai_compatible"]).default("none"),
  GROQ_API_KEY: optional,
  GROQ_MODEL: optional,
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  OPENAI_COMPATIBLE_API_KEY: optional,
  OPENAI_COMPATIBLE_MODEL: optional,
  OPENAI_COMPATIBLE_BASE_URL: optional,
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8192).default(900),

  OCR_PROVIDER: z.enum(["none", "tesseract_cli"]).default("none"),
  TESSERACT_PATH: z.string().default("tesseract"),

  EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,

  // Online billing (Razorpay subscriptions). Billing is enabled only when all four are set.
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
  /** Razorpay plan IDs per StockPilot plan, e.g. "starter:plan_ABC,growth:plan_DEF" (create the plans in the Razorpay dashboard). */
  RAZORPAY_PLAN_IDS: optional,
  RAZORPAY_API_BASE: z.string().url().default("https://api.razorpay.com/v1"),

  // Scheduled weekly report emails: the scheduler calls /api/cron/weekly-reports with this bearer token.
  CRON_SECRET: optional,

  MAX_IMPORT_FILE_MB: z.coerce.number().min(1).max(50).default(10),
  MAX_INVOICE_FILE_MB: z.coerce.number().min(1).max(25).default(8),
  TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(14),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
