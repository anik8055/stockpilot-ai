/** Errors whose message is safe to show to the user. Anything else is reported as a generic failure. */
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "bad_request",
    public details?: unknown,
  ) {
    super(message);
  }
}

export class AuthRequiredError extends AppError {
  constructor() {
    super("Please sign in to continue.", 401, "unauthenticated");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, 403, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, 404, "not_found");
  }
}

export class LimitError extends AppError {
  constructor(message: string) {
    super(message, 402, "plan_limit");
  }
}

export function publicMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err && typeof err === "object" && "retryAfterSeconds" in err) return (err as Error).message;
  return "Something went wrong. Please try again — if it keeps happening, contact support.";
}

/** Maps well-known Postgres errors to user-facing messages. */
export function fromPgError(err: unknown, uniqueMessage = "A record with these details already exists."): never {
  const code = (err as { code?: string })?.code;
  if (code === "23505") throw new AppError(uniqueMessage, 409, "conflict");
  if (code === "23503") throw new AppError("A referenced record does not exist or is in use.", 409, "reference");
  if (code === "23514") throw new AppError("A value is outside the allowed range.", 400, "check");
  if (code === "42501") throw new ForbiddenError();
  throw err;
}

export function logError(scope: string, err: unknown, extra?: Record<string, unknown>) {
  // Never log request bodies, tokens or document contents — only the error and safe metadata.
  const e = err instanceof Error ? { name: err.name, message: err.message, code: (err as { code?: string }).code } : { err: String(err) };
  console.error(JSON.stringify({ level: "error", scope, ...e, ...extra, at: new Date().toISOString() }));
}
