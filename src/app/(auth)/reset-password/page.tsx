import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { AuthCard } from "../card";
import { ResetForm } from "../forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token } = await props.searchParams;
  return (
    <AuthCard title="Choose a new password">
      {typeof token === "string" && token.length > 20 ? (
        <ResetForm token={token} />
      ) : (
        <Alert tone="danger" title="This link is incomplete">
          Open the link from your email again, or <Link href="/forgot-password" className="underline">request a new one</Link>.
        </Alert>
      )}
    </AuthCard>
  );
}
