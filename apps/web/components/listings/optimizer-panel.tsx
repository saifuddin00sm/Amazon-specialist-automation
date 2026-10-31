"use client";

import type { AgentRun } from "@app/core";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import { completeOptimizerRun, startListingOptimizer } from "@/app/(app)/listings/[productId]/actions";
import { AgentRunViewer } from "@/components/agents/agent-run-viewer";
import { Button } from "@/components/ui/button";

/**
 * "Run optimizer" plus the latest optimizer run for the product. A run that is still running plays
 * from the start; when its replay ends the run completes and its Proposal lands in the inbox.
 */
export function OptimizerPanel({
  productId,
  latestRun,
  pendingProposalId,
  canRun,
}: {
  productId: string;
  latestRun: AgentRun | undefined;
  /** A listing proposal for this product already waiting for a decision. */
  pendingProposalId: string | undefined;
  canRun: boolean;
}) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  const running = latestRun?.status === "running";
  const latestRunId = latestRun?.id;

  const run = () =>
    startTransition(async () => {
      const result = await startListingOptimizer({ productId });
      if (!result.ok) toast.error(result.message);
    });

  const complete = useCallback(() => {
    if (!latestRunId) return;
    void completeOptimizerRun({ runId: latestRunId }).then((result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      const { proposalId } = result;
      if (proposalId) {
        toast.success("Proposal added to the approval inbox", {
          action: { label: "Review", onClick: () => router.push(`/approvals?proposal=${proposalId}`) },
        });
      }
    });
  }, [latestRunId, router]);

  const blockedReason = !canRun
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
        ) : (
          <p className="text-sm text-muted-foreground">
            Drafts new copy from ProductFacts, checks compliance and revises until the reviewer signs off. Nothing goes live
            without approval.
          </p>
        )}
      </div>

      {latestRun ? (
        <AgentRunViewer key={latestRun.id} run={latestRun} autoPlay={running} onPlaybackEnd={complete} />
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          The optimizer hasn&apos;t run on this product yet.
        </p>
      )}
    </div>
  );
}
