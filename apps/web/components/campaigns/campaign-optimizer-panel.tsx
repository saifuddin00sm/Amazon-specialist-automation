"use client";

import type { AgentRun } from "@app/core";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";
import { completeCampaignOptimizerRun, startCampaignOptimizer } from "@/app/(app)/campaigns/[campaignId]/actions";
import { announceRunOutcome } from "@/components/agents/announce-run";
import { AgentRunViewer } from "@/components/agents/agent-run-viewer";
import { Button } from "@/components/ui/button";

/**
 * "Run optimizer" plus the latest optimizer run for the campaign. A run that is still running plays
 * from the start; when its replay ends the run completes and its campaign plan lands in the inbox.
 */
export function CampaignOptimizerPanel({
  campaignId,
  latestRun,
  pendingPlanId,
  blockedReason,
}: {
  campaignId: string;
  latestRun: AgentRun | undefined;
  /** A campaign plan for this campaign already waiting for a decision. */
  pendingPlanId: string | undefined;
  /** Why the optimizer can't run here at all (permissions, a paused campaign). */
  blockedReason: string | undefined;
}) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  const running = latestRun?.status === "running";
  const latestRunId = latestRun?.id;

  const run = () =>
    startTransition(async () => {
      const result = await startCampaignOptimizer({ campaignId });
      if (!result.ok) toast.error(result.message);
    });

  const complete = useCallback(() => {
    if (!latestRunId) return;
    void completeCampaignOptimizerRun({ runId: latestRunId }).then((result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      announceRunOutcome(result, { what: "Campaign plan", open: (href) => router.push(href) });
    });
  }, [latestRunId, router]);

  const blocked = blockedReason ?? (pendingPlanId && !running ? "A plan for this campaign is waiting for approval." : undefined);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={starting || running || Boolean(blocked)}>
          {starting || running ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {running ? "Optimizer running" : "Run optimizer"}
        </Button>
        {blocked ? (
          <p className="text-sm text-muted-foreground">
            {blocked}{" "}
            {pendingPlanId && (
              <Link className="font-medium text-foreground underline underline-offset-4" href={`/approvals?proposal=${pendingPlanId}`}>
                Review it
              </Link>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Moves bids toward target ACoS, adds ProductFacts keywords and negates what other campaigns already cover, as
            one plan. Nothing changes on Amazon without approval.
          </p>
        )}
      </div>

      {latestRun ? (
        <AgentRunViewer key={latestRun.id} run={latestRun} autoPlay={running} onPlaybackEnd={complete} />
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          The optimizer hasn&apos;t run on this campaign yet.
        </p>
      )}
    </div>
  );
}
