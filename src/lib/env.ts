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
