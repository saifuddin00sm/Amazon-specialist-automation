"use client";

import { AutonomyLevelSchema, ProposalTypeSchema, type AutonomyByAction, type AutonomyLevel, type ProposalType, type SellerAccount } from "@app/core";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateAccountSettings } from "@/app/(app)/settings/actions";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnersOnlyNote, SettingsSection } from "./settings-tabs";

export const AUTONOMY_DESCRIPTIONS: Record<AutonomyLevel, string> = {
  L0: "Suggest only: agents show what they would do and file nothing.",
  L1: "Draft: agents file proposals and a member decides each one.",
  L2: "Auto-approve low-risk changes that pass every guardrail; the rest wait for a member.",
  L3: "Auto-approve anything no guardrail blocks.",
};

/** What each action type is, and which agent proposes it today. */
const ACTION_TYPES: Record<ProposalType, { label: string; detail: string }> = {
  listing_update: { label: "Listing rewrites", detail: "Listing optimizer" },
  campaign_plan: { label: "Campaign plans", detail: "Campaign optimizer" },
  bid_change: { label: "Bid changes", detail: "Bid optimizer" },
  budget_change: { label: "Budget changes", detail: "Budget pacer" },
  keyword_add: { label: "New keywords", detail: "Keyword harvester" },
  keyword_negate: { label: "Negative keywords", detail: "Keyword harvester" },
  target_pause: { label: "Pausing targets", detail: "Bid optimizer" },
  price_change: { label: "Price changes", detail: "No agent yet" },
};

const DEFAULT = "default";

/** The selected account's autonomy: a default level, and optional levels per action type. */
export function AutonomyForm() {
  const { sellerAccount } = useSellerContext();
  if (!sellerAccount) return null;
  // Keyed so switching accounts starts from that account's saved levels.
  return <AutonomyFields key={sellerAccount.id} account={sellerAccount} />;
}

function AutonomyFields({ account }: { account: SellerAccount }) {
  const { member } = useSellerContext();
  const canEdit = member?.role === "owner";
  const [level, setLevel] = useState<AutonomyLevel>(account.autonomyLevel);
  const [overrides, setOverrides] = useState<AutonomyByAction>(account.autonomyByAction ?? {});
  const [saving, startTransition] = useTransition();
  const changed = level !== account.autonomyLevel || JSON.stringify(overrides) !== JSON.stringify(account.autonomyByAction ?? {});

  const save = () =>
    startTransition(async () => {
      const result = await updateAccountSettings({ sellerAccountId: account.id, autonomyLevel: level, autonomyByAction: overrides });
      if (result.ok) toast.success(`Autonomy saved for ${account.name}`);
      else toast.error(result.message);
    });

  const setOverride = (type: ProposalType, value: string) =>
    setOverrides((current) => {
      const next = { ...current };
      if (value === DEFAULT) delete next[type];
      else next[type] = value as AutonomyLevel;
      return next;
    });

  return (
    <SettingsSection
      title="Autonomy"
      description={`How far agents may go on ${account.name}, per kind of change. Guardrails apply at every level.`}
    >
      <fieldset disabled={!canEdit || saving} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-medium">Account default</span>
            <LevelSelect label="Account default" value={level} onChange={(value) => setLevel(value as AutonomyLevel)} />
          </div>
          <p className="text-sm text-muted-foreground">{AUTONOMY_DESCRIPTIONS[level]}</p>
        </div>

        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Action</th>
              <th className="py-2 font-medium">Proposed by</th>
              <th className="py-2 text-right font-medium">Level</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ProposalTypeSchema.options.map((type) => {
              const own = overrides[type];
              return (
                <tr key={type}>
                  <td className="py-2 pr-3 font-medium">{ACTION_TYPES[type].label}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{ACTION_TYPES[type].detail}</td>
                  <td className="py-2 text-right">
                    <LevelSelect
                      label={ACTION_TYPES[type].label}
                      value={own ?? DEFAULT}
                      defaultLevel={level}
                      onChange={(value) => setOverride(type, value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>

      <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        {AutonomyLevelSchema.options.map((option) => (
          <li key={option}>
            <span className="font-medium text-foreground">{option}</span> {AUTONOMY_DESCRIPTIONS[option]}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button onClick={save} disabled={!changed || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save autonomy
          </Button>
        )}
        <OwnersOnlyNote canEdit={canEdit} what="change autonomy" />
      </div>
    </SettingsSection>
  );
}

function LevelSelect({
  label,
  value,
  defaultLevel,
  onChange,
}: {
  label: string;
  value: string;
  /** When set, offers "Account default" too. */
  defaultLevel?: AutonomyLevel;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={`${label} autonomy`} className="ml-auto w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLevel && <SelectItem value={DEFAULT}>Account default ({defaultLevel})</SelectItem>}
        {AutonomyLevelSchema.options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
