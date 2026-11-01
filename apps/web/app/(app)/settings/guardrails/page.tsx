import type { Metadata } from "next";
import { GuardrailsForm } from "@/components/settings/guardrails-form";

export const metadata: Metadata = { title: "Guardrails" };

export default function GuardrailsPage() {
  return <GuardrailsForm />;
}
