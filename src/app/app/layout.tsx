import Link from "next/link";
import { logoutAction, switchWorkspaceAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/domain/dates";
import { requireTenant } from "@/lib/tenant";
import { listWorkspaces } from "@/lib/services/workspaces";
import { AppNav, MobileShell } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const t = await requireTenant();
  const workspaces = await listWorkspaces(t.userId);
  const trialEnds = t.business.planCode === "trial" && t.business.trialEndsAt ? new Date(t.business.trialEndsAt) : null;
  const trialDaysLeft = trialEnds ? Math.ceil((trialEnds.getTime() - Date.now()) / 86400000) : null;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4">
        <Logo href="/app/dashboard" inverted />
      </div>
      <form action={switchWorkspaceAction} className="px-3 pb-3">
        <label htmlFor="ws" className="sr-only">Workspace</label>
        {workspaces.length > 1 ? (
          <div className="flex gap-1.5">
            <select id="ws" name="businessId" defaultValue={t.businessId} className="h-9 min-w-0 flex-1 rounded-md border border-ink-3 bg-ink-2 px-2 text-sm text-white">
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <button type="submit" className="h-9 rounded-md border border-ink-3 px-2 text-xs text-[#c9d6ea] hover:bg-ink-2">Switch</button>
          </div>
        ) : (
          <p className="truncate rounded-md border border-ink-3 bg-ink-2 px-2.5 py-2 text-sm text-white" title={t.business.name}>{t.business.name}</p>
        )}
      </form>
      <AppNav />
      <div className="mt-auto border-t border-ink-3 px-4 py-4 text-sm">
        <p className="truncate font-medium text-white">{t.user.name}</p>
        <p className="truncate text-xs text-[#9fb2cf]">{ROLE_LABELS[t.role]} · {t.user.email}</p>
        <div className="mt-3 flex gap-3 text-xs">
          <Link href="/onboarding" className="text-[#c9d6ea] hover:text-white">Add workspace</Link>
          <form action={logoutAction}>
            <button type="submit" className="text-[#c9d6ea] hover:text-white">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <MobileShell sidebar={sidebar} businessName={t.business.name}>
      {t.business.isDemo && (
        <div className="border-b border-warn/25 bg-warn-soft px-4 py-2 text-sm text-warn sm:px-6">
          <strong>Demo workspace.</strong> Everything here is synthetic data for a fictional business — not real customers, suppliers or sales.
        </div>
      )}
      {trialDaysLeft !== null && (
        <div className="border-b border-line bg-signal-soft px-4 py-2 text-sm text-signal-strong sm:px-6">
          {trialDaysLeft > 0 ? (
            <>Free trial: {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left (ends {formatDate(trialEnds)}). </>
          ) : (
            <>Your trial has ended — Growth features are paused. </>
          )}
          <Link href="/app/settings?tab=plan" className="font-medium underline">See plans</Link>
        </div>
      )}
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</div>
    </MobileShell>
  );
}
