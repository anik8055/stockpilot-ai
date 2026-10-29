import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AuthCard } from "../card";
import { LoginForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  if (await getSession()) redirect("/app/dashboard");
  return (
    <AuthCard title="Sign in to StockPilot" footer={<>New here? <Link href="/signup" className="font-medium text-signal hover:underline">Create an account</Link></>}>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthCard>
  );
}
