"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formObject, runAction, type ActionResult } from "@/lib/action-result";
import type { Role } from "@/lib/auth/permissions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { destroySession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { withAdmin } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { changePassword, deleteAccount } from "@/lib/services/accounts";
import { cancelSubscription, refreshSubscription, startSubscription } from "@/lib/services/billing";
import { updateAnalysisSettings, updateProfile } from "@/lib/services/settings";
import { deleteBusiness, regenerateJoinCode, removeMember, updateMemberRole } from "@/lib/services/workspaces";
import { requireTenant, tx } from "@/lib/tenant";

export async function profileAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.profile", async () => {
    const t = await requireTenant("settings.manage");
    await tx(t, (db) => updateProfile(db, t, formObject(fd)));
    revalidatePath("/app", "layout");
    return { ok: true, message: "Business details saved." };
  });
}

export async function analysisAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.analysis", async () => {
    const t = await requireTenant("settings.manage");
    await tx(t, (db) => updateAnalysisSettings(db, t, { ...formObject(fd), useTrendAdjustment: fd.get("useTrendAdjustment") === "on" }));
    revalidatePath("/app", "layout");
    return { ok: true, message: "Stock settings saved. Recommendations now use the new values." };
  });
}

export async function joinCodeAction(): Promise<ActionResult> {
  return runAction("settings.joincode", async () => {
    const t = await requireTenant("members.manage");
    await regenerateJoinCode(t);
    revalidatePath("/app/settings");
    return { ok: true, message: "New join code created. The old code no longer works." };
  });
}

export async function memberRoleAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.role", async () => {
    const t = await requireTenant("members.manage");
    const role = String(fd.get("role")) as Role;
    if (!["owner", "admin", "staff"].includes(role)) throw new AppError("Invalid role.");
    await updateMemberRole(t, String(fd.get("userId")), role);
    revalidatePath("/app/settings");
    return { ok: true, message: "Role updated." };
  });
}

export async function removeMemberAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.remove", async () => {
    const t = await requireTenant();
    const userId = String(fd.get("userId"));
    await removeMember(t, userId);
    if (userId === t.userId) redirect("/onboarding");
    revalidatePath("/app/settings");
    return { ok: true, message: "Member removed." };
  });
}

export async function changePasswordAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.password", async () => {
    const t = await requireTenant();
    await rateLimit(`pw-change:${t.userId}`, 10, 3600);
    if (fd.get("next") !== fd.get("confirm")) return { ok: false, message: "New passwords do not match." };
    await changePassword(t.userId, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
    return { ok: true, message: "Password changed." };
  });
}

export async function deleteWorkspaceAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.delete-workspace", async () => {
    const t = await requireTenant("business.delete");
    await rateLimit(`delete-ws:${t.userId}`, 5, 3600);
    if (String(fd.get("confirmName") ?? "").trim() !== t.business.name) return { ok: false, message: "Type the workspace name exactly to confirm." };
    const user = await withAdmin((db) => db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [t.userId]));
    if (!(await verifyPassword(user.password_hash, String(fd.get("password") ?? "")))) return { ok: false, message: "Password is incorrect." };
    await deleteBusiness(t);
    redirect("/onboarding");
  });
}

export async function deleteAccountAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.delete-account", async () => {
    const t = await requireTenant();
    await rateLimit(`delete-acct:${t.userId}`, 5, 3600);
    if (String(fd.get("confirm") ?? "") !== "DELETE") return { ok: false, message: 'Type DELETE to confirm.' };
    await deleteAccount(t.userId, String(fd.get("password") ?? ""));
    await destroySession().catch(() => undefined);
    redirect("/?account=deleted");
  });
}

export async function subscribeAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("settings.billing.subscribe", async () => {
    const t = await requireTenant("billing.manage");
    await rateLimit(`billing:${t.userId}`, 10, 3600);
    const url = await startSubscription(t, String(fd.get("plan") ?? ""));
    // Razorpay's hosted payment page; the plan changes only after Razorpay confirms the payment.
    redirect(url);
  });
}

export async function cancelSubscriptionAction(): Promise<ActionResult> {
  return runAction("settings.billing.cancel", async () => {
    const t = await requireTenant("billing.manage");
    await cancelSubscription(t);
    revalidatePath("/app", "layout");
    redirect("/app/settings?tab=plan&billing=cancelled");
  });
}

export async function refreshBillingAction(): Promise<ActionResult> {
  return runAction("settings.billing.refresh", async () => {
    const t = await requireTenant("billing.manage");
    await rateLimit(`billing-refresh:${t.userId}`, 30, 3600);
    const status = await refreshSubscription(t);
    revalidatePath("/app", "layout");
    return { ok: true, message: status ? `Payment provider reports this subscription as “${status}”.` : "No subscription found." };
  });
}
