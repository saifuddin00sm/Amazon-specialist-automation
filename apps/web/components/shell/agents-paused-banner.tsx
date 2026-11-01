"use client";

import { OctagonPause, Play } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { setAgentsPaused } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { useSellerContext } from "./seller-context";

/**
 * Shown on every page while the kill switch is on in the selected workspace, so nobody wonders why
 * agents are quiet. Owners can resume from here.
 */
export function AgentsPausedBanner() {
  const { workspace, member } = useSellerContext();
  const [resuming, startTransition] = useTransition();
  if (!workspace?.agentsPausedAt) return null;

  const resume = () =>
    startTransition(async () => {
      const result = await setAgentsPaused({ workspaceId: workspace.id, paused: false });
      if (result.ok) toast.success("Agents resumed");
      else toast.error(result.message);
    });

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm md:px-6"
      data-testid="agents-paused-banner"
    >
      <OctagonPause className="size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Agents are paused</span> in {workspace.name} since {formatDateTime(workspace.agentsPausedAt)}. No agent
        starts, files a proposal or auto-approves anything until an owner resumes them.
      </p>
      {member?.role === "owner" ? (
        <Button size="sm" variant="outline" onClick={resume} disabled={resuming}>
          <Play />
          Resume agents
        </Button>
      ) : (
        <Button asChild size="sm" variant="ghost">
          <Link href="/settings">Agent settings</Link>
        </Button>
      )}
    </div>
  );
}
