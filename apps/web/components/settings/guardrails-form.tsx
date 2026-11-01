"use client";

import { DEFAULT_GUARDRAILS, GuardrailsSchema, guardrailsFor, type Guardrails, type SellerAccount } from "@app/core";
import { Loader2, RotateCcw } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateAccountSettings } from "@/app/(app)/settings/actions";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OwnersOnlyNote, SettingsSection } from "./settings-tabs";

type Fields = Record<keyof Guardrails, string>;

/** Steps are stored as fractions and edited as percentages. */
const toFields = (guardrails: Guardrails): Fields => ({
  maxBid: String(guardrails.maxBid),
  maxBidStep: String(Math.round(guardrails.maxBidStep * 100)),
  maxDailyBudget: String(guardrails.maxDailyBudget),
  maxBudgetStep: String(Math.round(guardrails.maxBudgetStep * 100)),
});
const fromFields = (fields: Fields) => ({
  maxBid: Number(fields.maxBid),
  maxBidStep: Number(fields.maxBidStep) / 100,
  maxDailyBudget: Number(fields.maxDailyBudget),
  maxBudgetStep: Number(fields.maxBudgetStep) / 100,
});

/** Bid and budget caps for the selected account. */
export function GuardrailsForm() {
  const { sellerAccount } = useSellerContext();
  if (!sellerAccount) return null;
  return <GuardrailFields key={sellerAccount.id} account={sellerAccount} />;
}

function GuardrailFields({ account }: { account: SellerAccount }) {
  const { member } = useSellerContext();
  const canEdit = member?.role === "owner";
  const saved = guardrailsFor(account);
  const [fields, setFields] = useState<Fields>(toFields(saved));
  const [saving, startTransition] = useTransition();
  const id = useId();
  const parsed = GuardrailsSchema.safeParse(fromFields(fields));
  const changed = JSON.stringify(fields) !== JSON.stringify(toFields(saved));
  const currency = account.currency;

  const save = (guardrails: Guardrails | null) =>
    startTransition(async () => {
      const result = await updateAccountSettings({ sellerAccountId: account.id, guardrails });
      if (result.ok) {
        toast.success(guardrails ? `Guardrails saved for ${account.name}` : "Guardrails reset to the defaults");
        if (!guardrails) setFields(toFields(DEFAULT_GUARDRAILS));
      } else toast.error(result.message);
    });

  const field = (key: keyof Guardrails, label: string, unit: string, hint: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`${id}-${key}`}
          type="number"
          inputMode="decimal"
          min="0"
          step={unit === "%" ? "1" : "0.01"}
          className="w-36 tabular-nums"
          value={fields[key]}
          onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <SettingsSection
      title="Guardrails"
      description={`Caps on bids and budgets for ${account.name}, checked on every proposal before anyone, or any agent, can approve it.`}
    >
      <fieldset disabled={!canEdit || saving} className="grid gap-5 sm:grid-cols-2">
        {field("maxBid", "Bid cap", currency, "A bid above this blocks approval. Agents never propose above it.")}
        {field("maxBidStep", "Largest bid change per step", "%", "A bigger move is a warning, and L2 won't auto-approve it.")}
        {field("maxDailyBudget", "Daily budget cap", currency, "A daily budget above this blocks approval.")}
        {field("maxBudgetStep", "Largest budget change per step", "%", "A bigger move is a warning, and L2 won't auto-approve it.")}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <Button onClick={() => parsed.success && save(parsed.data)} disabled={!changed || !parsed.success || saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save guardrails
            </Button>
            <Button variant="ghost" disabled={saving || !account.guardrails} onClick={() => save(null)}>
              <RotateCcw />
              Use defaults
            </Button>
            {!parsed.success && <span className="text-sm text-destructive">{parsed.error.issues[0]?.message}</span>}
          </>
        )}
        <OwnersOnlyNote canEdit={canEdit} what="change guardrails" />
      </div>
    </SettingsSection>
  );
}
