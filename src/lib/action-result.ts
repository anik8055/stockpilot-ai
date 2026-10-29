import { z } from "zod";
import { publicMessage, logError, AppError } from "@/lib/errors";

export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
  /** Submitted values echoed back on failure (client-side only). */
  values?: Record<string, string>;
};

export function fieldErrorsFrom(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/** Runs a server action body, converting known errors into a user-facing ActionResult. */
export async function runAction(scope: string, fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    // Let Next.js redirect()/notFound() propagate
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    if (err instanceof z.ZodError) return { ok: false, message: "Please correct the highlighted fields.", fieldErrors: fieldErrorsFrom(err) };
    if (!(err instanceof AppError)) logError(scope, err);
    return { ok: false, message: publicMessage(err) };
  }
}

export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}
