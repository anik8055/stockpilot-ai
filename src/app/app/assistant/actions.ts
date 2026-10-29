"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ask, saveExchange } from "@/lib/services/assistant/assistant";
import { requireTenant, tx } from "@/lib/tenant";

export async function askAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("assistant.ask", async () => {
    const t = await requireTenant("assistant.use");
    await rateLimit(`assistant:${t.userId}`, 20, 60);
    const ctx = { userId: t.userId, businessId: t.businessId, settings: t.business.settings.analysis, timezone: t.business.timezone };
    await tx(t, async (db) => saveExchange(db, ctx, await ask(db, ctx, String(fd.get("question") ?? ""))));
    revalidatePath("/app/assistant");
    return { ok: true };
  });
}
