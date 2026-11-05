"use client";

import {
  CAMPAIGN_GOALS,
  CAMPAIGN_ROLE_LABELS,
  CampaignGoalSchema,
  buildCampaignStructure,
  checkProposalCompliance,
  goalTargetAcos,
  hasBlockingFailure,
  minimumPlanBudget,
  newCampaignDiff,
  suggestedDailyBudget,
  type AgentRun,
  type CampaignBrief,
  type CampaignGoal,
} from "@app/core";
import { cn } from "cn";
import { ArrowLeft, ArrowRight, Loader2, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { CatalogAccount } from "@/app/(app)/campaigns/new/load-catalog";
import { completeCampaignStrategistRun, startCampaignStrategist } from "@/app/(app)/campaigns/new/actions";
import { AgentRunViewer } from "@/components/agents/agent-run-viewer";
import { announceRunOutcome } from "@/components/agents/announce-run";
import { ComplianceResults } from "@/components/approvals/review-panels";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardSteps } from "@/components/wizard-steps";
import { formatMoney, formatPercent } from "@/lib/format";
import { UNIT_ECONOMICS_FIELDS, fieldsBreakEven, unitEconomicsFields, type UnitEconomicsField } from "./breakeven-calculator";
import { NewCampaignTree } from "./new-campaign-tree";

const STEPS = ["Products", "Goal and budget", "Preview"] as const;

/** The New campaign wizard for the seller account picked in the top bar. */
export function NewCampaignWizard({ catalog }: { catalog: Record<string, CatalogAccount> }) {
  const { sellerAccount } = useSellerContext();
  const account = sellerAccount ? catalog[sellerAccount.id] : undefined;
  if (!account) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Pick a seller account to plan campaigns for.</p>;
  }
  // Switching accounts starts over: products and budgets belong to one account.
  return <AccountWizard key={account.id} account={account} />;
}

function AccountWizard({ account }: { account: CatalogAccount }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [goal, setGoal] = useState<CampaignGoal>("grow");
  const [economics, setEconomics] = useState<{ forProducts: string; values: Record<UnitEconomicsField, string> }>();
  // Left empty, target ACoS and budget follow the goal and the breakeven; typing in them takes over.
  const [acosInput, setAcosInput] = useState<string>();
  const [budgetInput, setBudgetInput] = useState<string>();
  const [run, setRun] = useState<AgentRun>();
  const [proposalId, setProposalId] = useState<string>();
  const [submitting, startSubmit] = useTransition();
  const money = (amount: number) => formatMoney(amount, account.currency);

  const products = account.products;
  const chosen = products.filter((product) => selected.includes(product.id));
  const averagePrice = chosen.length > 0 ? chosen.reduce((sum, product) => sum + product.price, 0) / chosen.length : 0;
  const needle = query.trim().toLowerCase();
  const visible = products.filter(
    (product) =>
      needle === "" || [product.title, product.asin, product.sku, product.category].some((text) => text.toLowerCase().includes(needle)),
  );

  const values = economics?.values ?? unitEconomicsFields(averagePrice);
  const breakEven = fieldsBreakEven(values);
  const suggestedAcos = goalTargetAcos(goal, breakEven, account.targetAcos);
  const suggestedBudget = Math.min(suggestedDailyBudget(goal, chosen.length), account.guardrails.maxDailyBudget);
  const targetAcos = (acosInput === undefined ? suggestedAcos * 100 : Number.parseFloat(acosInput)) / 100;
  const dailyBudget = budgetInput === undefined ? suggestedBudget : Number.parseFloat(budgetInput);

  const acosValid = Number.isFinite(targetAcos) && targetAcos > 0 && targetAcos <= 1;
  const budgetValid = Number.isFinite(dailyBudget) && dailyBudget > 0;
  const brief: CampaignBrief | undefined =
    chosen.length > 0 && acosValid && budgetValid
      ? {
          goal,
          productIds: chosen.map((product) => product.id),
          dailyBudget: Math.round(dailyBudget * 100) / 100,
          targetAcos,
          ...(breakEven !== undefined ? { breakEvenAcos: breakEven } : {}),
        }
      : undefined;

  const productFacts = useMemo(() => products.map((product) => ({ productId: product.id, targetKeywords: product.targetKeywords })), [products]);
  const structure = brief && buildCampaignStructure({ brief, products, productFacts, guardrails: account.guardrails });
  const minimumBudget = minimumPlanBudget(structure?.campaigns.length ?? 4);
  const checks = brief && structure ? checkProposalCompliance({ type: "new_campaign", diff: newCampaignDiff(brief, structure.campaigns), guardrails: account.guardrails }) : [];
  const stepTwoError = !acosValid
    ? "Enter a target ACoS between 1% and 100%."
    : !budgetValid || dailyBudget < minimumBudget
      ? `Enter a daily budget of at least ${money(minimumBudget)}, so each campaign gets Amazon's minimum.`
      : undefined;

  const toggle = (id: string, on: boolean) => setSelected((current) => (on ? [...current, id] : current.filter((candidate) => candidate !== id)));

  const toGoal = () => {
    // Fresh estimates when the products changed since they were last set.
    const key = selected.join(",");
    if (economics?.forProducts !== key) setEconomics({ forProducts: key, values: unitEconomicsFields(averagePrice) });
    setStep(1);
  };

  const submit = () => {
    if (!brief) return;
    startSubmit(async () => {
      const result = await startCampaignStrategist({ sellerAccountId: account.id, brief });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRun(result.run);
    });
  };

  const runId = run?.id;
  const complete = useCallback(() => {
    if (!runId) return;
    void completeCampaignStrategistRun({ runId }).then((result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRun(result.run);
      setProposalId(result.proposalId);
      announceRunOutcome(result, { what: "New campaign plan", open: (href) => router.push(href) });
    });
  }, [runId, router]);

  if (run) {
    const finished = run.status !== "running";
    return (
      <div className="flex flex-col gap-4">
        <AgentRunViewer key={run.id} run={run} autoPlay onPlaybackEnd={complete} />
        {finished && (
          <div className="flex flex-wrap items-center gap-2">
            {proposalId && (
              <Button asChild>
                <Link href={`/approvals?proposal=${proposalId}`}>
                  Review the plan in Approvals
                  <ArrowRight />
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/campaigns">Back to campaigns</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <WizardSteps steps={STEPS} current={step} />

      {step === 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="wizard-products">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-products" className="text-lg font-semibold">
              Choose products
            </h2>
            <p className="text-sm text-muted-foreground">Every campaign advertises the products you pick. Their ProductFacts keywords seed the keyword campaigns.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" aria-label="Search products" className="pl-8" />
            </div>
            <span className="text-sm text-muted-foreground tabular-nums">
              {chosen.length} selected{chosen.length > 0 && ` · ${money(averagePrice)} average price`}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Selected</span>
                  </th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Keywords</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((product) => {
                  const active = product.status === "active";
                  const checked = selected.includes(product.id);
                  return (
                    <tr key={product.id} className={cn(checked && "bg-primary/5", !active && "text-muted-foreground")} data-testid="catalog-product">
                      <td className="px-3 py-2">
                        <Checkbox
                          id={`product-${product.id}`}
                          checked={checked}
                          disabled={!active}
                          aria-label={`Advertise ${product.title}`}
                          onCheckedChange={(value) => toggle(product.id, value === true)}
                        />
                      </td>
                      <td className="max-w-md px-3 py-2">
                        <label htmlFor={`product-${product.id}`} className={cn("font-medium", active && "cursor-pointer")}>
                          {product.title}
                        </label>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            ASIN {product.asin} · SKU {product.sku}
                          </span>
                          {!active && (
                            <Badge variant="outline" className="capitalize">
                              {product.status}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{product.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{product.targetKeywords.length}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(product.price)}</td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                      {products.length === 0 ? "This account has no products yet." : "No products match."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={toGoal} disabled={chosen.length === 0}>
              Continue
              <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-5" aria-labelledby="wizard-goal">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-goal" className="text-lg font-semibold">
              Goal and budget
            </h2>
            <p className="text-sm text-muted-foreground">The goal sets target ACoS against your breakeven, and how the daily budget is split.</p>
          </div>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">Goal</legend>
            {CampaignGoalSchema.options.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-xl border bg-card p-4 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  goal === option && "border-primary bg-primary/5",
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="goal" value={option} checked={goal === option} onChange={() => setGoal(option)} className="accent-primary" />
                  {CAMPAIGN_GOALS[option].label}
                </span>
                <span className="text-muted-foreground">{CAMPAIGN_GOALS[option].description}</span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Breakeven ACoS</h3>
                <p className="text-xs text-muted-foreground">Starting values are estimates from the average price. Enter your own.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {UNIT_ECONOMICS_FIELDS.map(({ key, label, step: inputStep, suffix }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`wizard-${key}`} className="text-xs font-normal text-muted-foreground">
                      {label}
                      {suffix && ` (${suffix})`}
                    </Label>
                    <Input
                      id={`wizard-${key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step={inputStep}
                      className="tabular-nums"
                      value={values[key]}
                      onChange={(event) =>
                        setEconomics({ forProducts: selected.join(","), values: { ...values, [key]: event.target.value } })
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="flex items-baseline gap-2 border-t pt-3" aria-live="polite">
                <span className="text-2xl font-semibold tabular-nums" data-testid="wizard-breakeven">
                  {breakEven === undefined ? "–" : formatPercent(breakEven)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {breakEven === undefined ? "Enter a price" : breakEven <= 0 ? "No ad spend is profitable at this margin" : "breakeven ACoS"}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-target-acos">Target ACoS (%)</Label>
                <Input
                  id="wizard-target-acos"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="100"
                  step="1"
                  className="tabular-nums"
                  value={acosInput ?? String(Math.round(suggestedAcos * 100))}
                  onChange={(event) => setAcosInput(event.target.value)}
                />
                <Suggestion
                  text={
                    breakEven !== undefined && breakEven > 0
                      ? `${CAMPAIGN_GOALS[goal].label}: ${CAMPAIGN_GOALS[goal].acosFactor}× the ${formatPercent(breakEven)} breakeven = ${formatPercent(suggestedAcos, 0)}`
                      : `No margin to work from; the account's ${formatPercent(account.targetAcos, 0)} target`
                  }
                  overridden={acosInput !== undefined}
                  onReset={() => setAcosInput(undefined)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-budget">Daily budget ({account.currency})</Label>
                <Input
                  id="wizard-budget"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="1"
                  className="tabular-nums"
                  value={budgetInput ?? String(suggestedBudget)}
                  onChange={(event) => setBudgetInput(event.target.value)}
                />
                <Suggestion
                  text={`For ${CAMPAIGN_GOALS[goal].label.toLowerCase()} with ${chosen.length} ${chosen.length === 1 ? "product" : "products"}: ${money(suggestedBudget)}, split across the campaigns`}
                  overridden={budgetInput !== undefined}
                  onReset={() => setBudgetInput(undefined)}
                />
              </div>
              {stepTwoError && (
                <p className="text-sm text-destructive" role="alert">
                  {stepTwoError}
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={() => setStep(2)} disabled={stepTwoError !== undefined}>
              Preview
              <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && brief && structure && (
        <section className="flex flex-col gap-4" aria-labelledby="wizard-preview">
          <div className="flex flex-col gap-1">
            <h2 id="wizard-preview" className="text-lg font-semibold">
              Preview
            </h2>
            <p className="text-sm text-muted-foreground">
              This is the structure the campaign strategist will propose. You approve or reject it in Approvals; nothing is created until then.
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
            <Stat label="Goal">{CAMPAIGN_GOALS[goal].label}</Stat>
            <Stat label="Campaigns">{structure.campaigns.length}</Stat>
            <Stat label="Daily budget">{money(brief.dailyBudget)}</Stat>
            <Stat label="Target ACoS">{formatPercent(brief.targetAcos, 0)}</Stat>
            <Stat label="Base bid">{money(structure.baseBid)}</Stat>
            <Stat label="Keywords">{structure.keywords.length}</Stat>
          </dl>
          <p className="text-xs text-muted-foreground">
            Bids are shares of the base bid: the most a click can cost at target ACoS on a {money(structure.averagePrice)} order, assuming 1 in 10
            clicks orders until there&apos;s data.
          </p>
          {structure.skipped.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {structure.skipped.map((skip) => (
                <li key={skip.role}>
                  <span className="font-medium text-foreground">{CAMPAIGN_ROLE_LABELS[skip.role]}</span> left out: {skip.reason}
                </li>
              ))}
            </ul>
          )}
          <NewCampaignTree
            campaigns={structure.campaigns}
            currency={account.currency}
            productTitles={Object.fromEntries(chosen.map((product) => [product.id, product.title]))}
          />
          <ComplianceResults checks={checks} />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)} disabled={submitting}>
              <ArrowLeft />
              Back
            </Button>
            <Button onClick={submit} disabled={submitting || hasBlockingFailure(checks)}>
              {submitting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Create plan
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Suggestion({ text, overridden, onReset }: { text: string; overridden: boolean; onReset: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>Suggested · {text}</span>
      {overridden && (
        <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={onReset}>
          Use suggested
        </button>
      )}
    </p>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  );
}
