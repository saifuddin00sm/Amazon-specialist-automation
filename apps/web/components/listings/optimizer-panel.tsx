"use client";

import type { AgentRun } from "@app/core";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { startListingOptimizer } from "@/app/(app)/listings/[productId]/actions";
import { announceRunOutcome } from "@/components/agents/announce-run";
import { AgentRunViewer } from "@/components/agents/agent-run-viewer";
import { Button } from "@/components/ui/button";
import type { RunOutcome } from "@/lib/runs";

/** How often the page is read again while a run is taking steps. */
const FOLLOW_MS = 1_500;

/**
 * "Run optimizer" plus the latest optimizer run for the product. The optimizeListing workflow takes
 * the run in the background; while it runs, the page is read again every FOLLOW_MS and the viewer
 * plays each step as it lands. When the run finishes, its Proposal is in the inbox.
 */
export function OptimizerPanel({
  productId,
  latestRun,
  latestOutcome,
  latestStalled,
  pendingProposalId,
  canRun,
  agentsPaused,
}: {
  productId: string;
  latestRun: AgentRun | undefined;
  /** How the latest run ended, once it has. */
  latestOutcome: RunOutcome | undefined;
  /** The latest run is marked running, but nothing is taking it any more; running again closes it. */
  latestStalled: boolean;
  /** A listing proposal for this product already waiting for a decision. */
  pendingProposalId: string | undefined;
  canRun: boolean;
  /** The kill switch is on in this workspace. */
  agentsPaused: boolean;
}) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  const running = latestRun?.status === "running" && !latestStalled;

  // The run's steps are written as the workflow takes them; reading the page again brings them here.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => router.refresh(), FOLLOW_MS);
    return () => window.clearInterval(timer);
  }, [running, router]);

  const run = () =>
    startTransition(async () => {
      const result = await startListingOptimizer({ productId });
      if (!result.ok) toast.error(result.message);
    });

  // Once the member has watched the run to its end.
  const ended = useCallback(() => {
    if (!latestRun) return;
    if (latestStalled) {
      toast.error("The optimizer stopped responding", { description: "Nothing changed on Amazon. Run it again to start over." });
      return;
    }
    if (latestRun.status === "failed") {
      toast.error("The optimizer stopped", { description: latestRun.error });
      return;
    }
    announceRunOutcome({ outcome: latestOutcome, proposalId: latestRun.proposalIds[0] }, { what: "Proposal", open: (href) => router.push(href) });
  }, [latestRun, latestOutcome, latestStalled, router]);

  const blockedReason = agentsPaused
    ? "Agents are paused in this workspace. An owner can resume them in Settings."
    : !canRun
    ? "You can't run agents on this account."
    : pendingProposalId && !running
      ? "A listing proposal for this product is waiting for approval."
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={starting || running || Boolean(blockedReason)}>
          {starting || running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {running ? "Optimizer running" : "Run optimizer"}
        </Button>
        {blockedReason ? (
          <p className="text-sm text-muted-foreground">
            {blockedReason}{" "}
            {pendingProposalId && (
              <Link className="font-medium text-foreground underline underline-offset-4" href={`/approvals?proposal=${pendingProposalId}`}>
                Review it
              </Link>
            )}
          </p>
        ) : latestStalled ? (
          <p className="text-sm text-muted-foreground">
            The last run stopped responding and won&apos;t finish. Nothing changed on Amazon; running the optimizer again closes it.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drafts new copy from ProductFacts, checks it against the rules and has a second model review it, up to three rounds until
            it scores 85. Nothing goes live without approval.
          </p>
        )}
      </div>

      {latestRun ? (
        <AgentRunViewer key={latestRun.id} run={latestRun} autoPlay={running} live={!latestStalled} stalled={latestStalled} onPlaybackEnd={ended} />
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          The optimizer hasn&apos;t run on this product yet.
        </p>
      )}
    </div>
  );
}
