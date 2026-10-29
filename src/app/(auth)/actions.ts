"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formObject, runAction, type ActionResult } from "@/lib/action-result";
import { RateLimitError, rateLimit } from "@/lib/auth/rate-limit";
import { clientIp, createSession, destroySession, getSession, setActiveBusiness } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { authenticate, registerUser, requestPasswordReset, resetPassword, signupSchema } from "@/lib/services/accounts";
import { createBusiness, joinBusinessByCode, businessSchema } from "@/lib/services/workspaces";
import { createDemoWorkspace } from "@/lib/services/demo";

function safeNext(next: string | undefined) {
  return next && next.startsWith("/app") && !next.startsWith("//") ? next : "/app/dashboard";
}

export async function signupAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("auth.signup", async () => {
    await rateLimit(`signup:${await clientIp()}`, 10, 3600);
    const input = signupSchema.parse(formObject(fd));
    if (fd.get("terms") !== "on") return { ok: false, message: "Please accept the terms and privacy policy.", fieldErrors: { terms: "Required" } };
    const user = await registerUser(input);
    await createSession(user.id, null);
    redirect("/onboarding");
  });
}

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("auth.login", async () => {
    const { email = "", password = "", next } = formObject(fd);
    const ip = await clientIp();
    try {
      await rateLimit(`login:ip:${ip}`, 30, 900);
      await rateLimit(`login:email:${email.trim().toLowerCase()}`, 8, 900);
    } catch (e) {
      if (e instanceof RateLimitError) return { ok: false, message: `Too many sign-in attempts. Try again in ${Math.ceil(e.retryAfterSeconds / 60)} minute(s).` };
      throw e;
    }
    const user = await authenticate(email, password);
    if (!user) return { ok: false, message: "Email or password is incorrect." };
    await createSession(user.id, null);
    redirect(safeNext(next));
  });
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function forgotPasswordAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("auth.forgot", async () => {
    const email = String(fd.get("email") ?? "");
    await rateLimit(`reset:ip:${await clientIp()}`, 10, 3600);
    await rateLimit(`reset:email:${email.trim().toLowerCase()}`, 3, 3600);
    await requestPasswordReset(email);
    return { ok: true, message: "If an account exists for that email, we've sent a link to reset the password. It expires in 1 hour." };
  });
}

export async function resetPasswordAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("auth.reset", async () => {
    const { token = "", password = "", confirm = "" } = formObject(fd);
    if (password !== confirm) return { ok: false, message: "Passwords do not match.", fieldErrors: { confirm: "Passwords do not match" } };
    await rateLimit(`reset-submit:${await clientIp()}`, 20, 3600);
    await resetPassword(token, password);
    return { ok: true, message: "Password updated. You can now sign in with your new password." };
  });
}

async function requireSessionForOnboarding() {
  const session = await getSession();
  if (!session) redirect("/login?next=/onboarding");
  return session;
}

export async function createBusinessAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("onboarding.create", async () => {
    const session = await requireSessionForOnboarding();
    await rateLimit(`create-business:${session.user.id}`, 10, 3600);
    const b = await createBusiness(session.user.id, formObject(fd) as z.input<typeof businessSchema>);
    await setActiveBusiness(session.id, session.user.id, b.id);
    redirect("/app/imports?welcome=1");
  });
}

export async function joinBusinessAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("onboarding.join", async () => {
    const session = await requireSessionForOnboarding();
    await rateLimit(`join:${session.user.id}`, 10, 3600);
    const b = await joinBusinessByCode(session.user.id, String(fd.get("code") ?? ""));
    await setActiveBusiness(session.id, session.user.id, b.id);
    redirect("/app/dashboard");
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by useActionState
export async function createDemoAction(_prev?: ActionResult | null, _fd?: FormData): Promise<ActionResult> {
  return runAction("onboarding.demo", async () => {
    const session = await requireSessionForOnboarding();
    await rateLimit(`demo:${session.user.id}`, 3, 3600);
    const id = await createDemoWorkspace(session.user.id);
    await setActiveBusiness(session.id, session.user.id, id);
    redirect("/app/dashboard");
  });
}

export async function switchWorkspaceAction(fd: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const id = String(fd.get("businessId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("Invalid workspace.");
  const ok = await setActiveBusiness(session.id, session.user.id, id);
  if (!ok) throw new AppError("You are not a member of that workspace.", 403);
  redirect("/app/dashboard");
}
