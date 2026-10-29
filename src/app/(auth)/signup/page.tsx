import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "../card";
import { SignupForm } from "../forms";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Start your 14-day free trial"
      description="No card needed. You'll set up your business in the next step."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-signal hover:underline">Sign in</Link></>}
    >
      <SignupForm />
    </AuthCard>
  );
}
