import "server-only";
import { cancelSubscriptionsForDeletion } from "@/lib/services/billing";
import { z } from "zod";
import { dummyVerify, hashPassword, passwordSchema, verifyPassword } from "@/lib/auth/password";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { withAdmin } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sendEmail } from "./email";
import { storage } from "@/lib/storage";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
});

export async function registerUser(input: z.infer<typeof signupSchema>): Promise<{ id: string }> {
  const data = signupSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  try {
    return await withAdmin((tx) =>
      tx.one<{ id: string }>("INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id", [data.email, data.name, passwordHash]),
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new AppError("An account with this email already exists. Sign in instead, or reset your password.", 409, "email_taken");
    }
    throw err;
  }
}

export async function authenticate(email: string, password: string): Promise<{ id: string } | null> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success || !password) return null;
  const user = await withAdmin((tx) =>
    tx.maybeOne<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL", [parsed.data]),
  );
  if (!user) {
    await dummyVerify(password);
    return null;
  }
  return (await verifyPassword(user.password_hash, password)) ? { id: user.id } : null;
}

/** Always behaves the same whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string): Promise<void> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return;
  const user = await withAdmin((tx) => tx.maybeOne<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = $1 AND deleted_at IS NULL", [parsed.data]));
  if (!user) return;
  const token = newToken();
  await withAdmin(async (tx) => {
    await tx.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
    await tx.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [user.id, hashToken(token)]);
  });
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: parsed.data,
    template: "password_reset",
    subject: "Reset your StockPilot password",
    text: `Hello ${user.name},\n\nUse this link to set a new password. It expires in 1 hour and can be used once:\n${link}\n\nIf you did not ask for this, you can ignore this email.\n\n— StockPilot AI`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const password = passwordSchema.parse(newPassword);
  const hash = await hashPassword(password);
  await withAdmin(async (tx) => {
    const row = await tx.maybeOne<{ id: string; user_id: string }>(
      "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE",
      [hashToken(token)],
    );
    if (!row) throw new AppError("This reset link is invalid or has expired. Request a new one.", 400, "invalid_token");
    await tx.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    await tx.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [hash, row.user_id]);
    // Sign out everywhere after a reset
    await tx.query("DELETE FROM sessions WHERE user_id = $1", [row.user_id]);
  });
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const password = passwordSchema.parse(next);
  const user = await withAdmin((tx) => tx.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]));
  if (!(await verifyPassword(user.password_hash, current))) throw new AppError("Current password is incorrect.", 400, "bad_password");
  const hash = await hashPassword(password);
  await withAdmin((tx) => tx.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [hash, userId]));
}

/**
 * Deletes the user's account. Workspaces where they are the only owner are deleted with all their data
 * (cascade); in shared workspaces only their membership is removed.
 */
export async function deleteAccount(userId: string, password: string): Promise<{ deletedWorkspaces: number }> {
  const user = await withAdmin((tx) => tx.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]));
  if (!(await verifyPassword(user.password_hash, password))) throw new AppError("Password is incorrect.", 400, "bad_password");
  // Stop any paid subscriptions of workspaces that will be deleted before deleting anything.
  const soleOwned = await withAdmin((tx) =>
    tx.query<{ business_id: string }>(
      `SELECT m.business_id FROM memberships m
        WHERE m.user_id = $1 AND m.role = 'owner'
          AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.business_id = m.business_id AND o.role = 'owner' AND o.user_id <> $1)`,
      [userId],
    ),
  );
  await cancelSubscriptionsForDeletion(soleOwned.map((r) => r.business_id));
  const result = await withAdmin(async (tx) => {
    const sole = await tx.query<{ business_id: string }>(
      `SELECT m.business_id FROM memberships m
        WHERE m.user_id = $1 AND m.role = 'owner'
          AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.business_id = m.business_id AND o.role = 'owner' AND o.user_id <> $1)`,
      [userId],
    );
    const ids = sole.map((r) => r.business_id);
    if (ids.length) await tx.query("DELETE FROM businesses WHERE id = ANY($1::uuid[])", [ids]);
    await tx.query("UPDATE businesses SET created_by = NULL WHERE created_by = $1", [userId]);
    await tx.query("DELETE FROM users WHERE id = $1", [userId]);
    return { ids };
  });
  for (const id of result.ids) await storage().removePrefix(`${id}/`);
  return { deletedWorkspaces: result.ids.length };
}
