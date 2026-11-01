import { Bot } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border bg-card p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Bot className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold">Sign in to {siteConfig.name}</h1>
          <p className="text-sm text-muted-foreground">We&apos;ll email you a link. No password needed.</p>
        </div>
        <Suspense fallback={<LoginForm linkError={false} />}>
          <LoginFormWithError searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginFormWithError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  return <LoginForm linkError={error === "link"} />;
}
