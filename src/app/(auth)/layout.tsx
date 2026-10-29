import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-paper px-4 py-10">
      <Logo />
      <main className="mt-8 w-full max-w-md">{children}</main>
    </div>
  );
}
