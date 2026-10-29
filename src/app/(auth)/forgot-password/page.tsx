import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "../card";
import { ForgotForm } from "../forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" description="Enter your account email and we'll send you a link to choose a new password." footer={<Link href="/login" className="text-signal hover:underline">Back to sign in</Link>}>
      <ForgotForm />
    </AuthCard>
  );
}
