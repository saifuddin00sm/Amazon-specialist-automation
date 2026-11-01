"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const EmailSchema = z.email("Enter a valid email address.");

/**
 * Emails a sign-in link. Only existing members get one (signups are off), but the reply is the same
 * either way so the form doesn't reveal who is a member.
 */
export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const env = serverEnv();
  if (env.DATA_SOURCE !== "supabase") return { status: "error", message: "Sign-in is off while DATA_SOURCE is mock." };

  const parsed = EmailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email address." };

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin") ?? `http://${requestHeaders.get("host")}`;
  const supabase = await createSupabaseServerClient(env);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    // The email template links to `${origin}/auth/confirm`.
    options: { shouldCreateUser: false, emailRedirectTo: origin },
  });
  if (error?.status === 429) return { status: "error", message: "Too many sign-in emails. Wait a minute and try again." };
  return { status: "sent", email: parsed.data };
}

export async function signOut(): Promise<void> {
  const env = serverEnv();
  if (env.DATA_SOURCE === "supabase") {
    const supabase = await createSupabaseServerClient(env);
    await supabase.auth.signOut();
  }
  redirect("/login");
}
