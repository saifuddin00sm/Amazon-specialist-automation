"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";
import { sendMagicLink, type MagicLinkState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ linkError }: { linkError: boolean }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="flex flex-col items-center gap-2 text-center" role="status">
        <MailCheck className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          If {state.email} belongs to a member, a sign-in link is on its way. It works once and expires in an hour.
        </p>
      </div>
    );
  }

  const message = state.status === "error" ? state.message : linkError ? "That sign-in link is invalid or has expired." : undefined;
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </div>
      {message && (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
