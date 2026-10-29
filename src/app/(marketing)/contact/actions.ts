"use server";

import { formObject, runAction, type ActionResult } from "@/lib/action-result";
import { clientIp } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { saveDemoRequest } from "@/lib/services/public";

export async function demoRequestAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction("contact.demo", async () => {
    await rateLimit(`demo-request:${await clientIp()}`, 5, 3600);
    await saveDemoRequest(formObject(fd));
    return { ok: true, message: "Thanks — your request has been received. We'll get back to you by email." };
  });
}
