"use client";

import { MarketplaceSchema, type Marketplace } from "@app/core";
import { CircleCheck, Loader2, Plug, ShieldCheck } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { connectAmazonAccount } from "@/app/(app)/settings/actions";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const MARKETPLACE_NAMES: Record<Marketplace, string> = {
  US: "United States · amazon.com",
  CA: "Canada · amazon.ca",
  MX: "Mexico · amazon.com.mx",
  UK: "United Kingdom · amazon.co.uk",
  DE: "Germany · amazon.de",
  FR: "France · amazon.fr",
  IT: "Italy · amazon.it",
  ES: "Spain · amazon.es",
  JP: "Japan · amazon.co.jp",
};

const SCOPES = ["Listings and product data", "Sponsored ads: campaigns, bids and budgets", "Sales and traffic reports"];

type Step = "details" | "authorize" | "done";

/**
 * The Phase 1 stand-in for Amazon's authorization: pick a marketplace, approve access on a mock
 * Seller Central screen, and the account is connected. Nothing is sent to Amazon.
 */
export function ConnectAmazonDialog() {
  const { workspace, selectSellerAccount } = useSellerContext();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [marketplace, setMarketplace] = useState<Marketplace>("US");
  const [error, setError] = useState<string>();
  const [connectedId, setConnectedId] = useState<string>();
  const [connecting, startTransition] = useTransition();
  const id = useId();

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setStep("details");
      setName("");
      setMarketplace("US");
      setError(undefined);
    }
  };

  const authorize = () =>
    startTransition(async () => {
      if (!workspace) return;
      const result = await connectAmazonAccount({ workspaceId: workspace.id, name, marketplace });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setConnectedId(result.id);
      setStep("done");
    });

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <Plug />
          Connect Amazon
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {step === "details" && (
          <>
            <DialogHeader>
              <DialogTitle>Connect an Amazon seller account</DialogTitle>
              <DialogDescription>Pick the marketplace, then sign in to Seller Central to let agents read and propose changes.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>Account name</Label>
                <Input id={`${id}-name`} value={name} maxLength={80} placeholder="e.g. Northlane DE" onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-marketplace`}>Marketplace</Label>
                <Select value={marketplace} onValueChange={(value) => setMarketplace(value as Marketplace)}>
                  <SelectTrigger id={`${id}-marketplace`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MarketplaceSchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {MARKETPLACE_NAMES[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => reset(false)}>
                Cancel
              </Button>
              <Button disabled={!name.trim()} onClick={() => setStep("authorize")}>
                Continue to Amazon
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "authorize" && (
          <>
            <DialogHeader>
              <DialogTitle>Amazon Seller Central</DialogTitle>
              <DialogDescription>Simulated sign-in for Phase 1. Nothing is sent to Amazon.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 text-sm" data-testid="amazon-consent">
              <p className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {workspace?.name} is asking for access to {name.trim()} on {MARKETPLACE_NAMES[marketplace].split(" · ")[1]}:
              </p>
              <ul className="ml-6 list-disc text-muted-foreground">
                {SCOPES.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">Agents only propose changes; nothing changes on Amazon without an approved proposal.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" disabled={connecting} onClick={() => setStep("details")}>
                Back
              </Button>
              <Button disabled={connecting} onClick={authorize}>
                {connecting && <Loader2 className="animate-spin" />}
                Authorize
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {name.trim()} is connected
              </DialogTitle>
              <DialogDescription>
                It starts empty: products, campaigns and reports appear once Amazon sends the first data. New accounts start at autonomy L1
                with the default guardrails.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => reset(false)}>
                Done
              </Button>
              {connectedId && (
                <Button
                  onClick={() => {
                    selectSellerAccount(connectedId);
                    reset(false);
                  }}
                >
                  Switch to it
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
