import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/services/workspaces";
import { AuthCard } from "../card";
import { OnboardingForms } from "../forms";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/onboarding");
  const workspaces = await listWorkspaces(session.user.id);
  return (
    <AuthCard
      title={`Welcome, ${session.user.name.split(" ")[0]}`}
      description="Set up a workspace for your business, or join one your team already uses."
      footer={
        <div className="flex justify-center gap-4">
          {workspaces.length > 0 && <Link href="/app/dashboard" className="text-signal hover:underline">Go to my workspace</Link>}
          <form action={logoutAction}>
            <button type="submit" className="text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      }
    >
      <OnboardingForms hasDemo={workspaces.some((w) => w.isDemo)} />
    </AuthCard>
  );
}
