"use client";

import { OctagonPause, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setAgentsPaused } from "@/app/(app)/settings/actions";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { SettingsSection } from "./settings-tabs";

/** The workspace kill switch. Owners and specialists pause; owners resume. */
export function KillSwitch() {
  const { workspace, member } = useSellerContext();
  const [confirming, setConfirming] = useState(false);
  const [saving, startTransition] = useTransition();
  if (!workspace) return null;

  const paused = workspace.agentsPausedAt !== undefined;
  const canPause = member?.role === "owner" || member?.role === "specialist";
  const canResume = member?.role === "owner";

  const toggle = (next: boolean) =>
    startTransition(async () => {
      const result = await setAgentsPaused({ workspaceId: workspace.id, paused: next });
      setConfirming(false);
      if (result.ok) toast.success(next ? "All agents paused" : "Agents resumed");
      else toast.error(result.message);
    });

  return (
    <SettingsSection
      title="Kill switch"
      description={`Stops every agent in ${workspace.name} at once: runs in flight are cancelled, and nothing starts, gets filed or is auto-approved until an owner resumes. Decisions members make by hand still work.`}
    >
      <div
        className={
          paused
            ? "flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4"
            : "flex flex-wrap items-center gap-3 rounded-lg border p-4"
        }
        data-testid="kill-switch"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{paused ? "Agents are paused" : "Agents are running"}</span>
          <span className="text-sm text-muted-foreground">
            {paused && workspace.agentsPausedAt
              ? `Paused ${formatDateTime(workspace.agentsPausedAt)}.`
              : "They work within each account's autonomy level and guardrails."}
          </span>
        </div>
        {paused ? (
          <Button variant="outline" disabled={!canResume || saving} onClick={() => toggle(false)}>
            <Play />
            Resume agents
          </Button>
        ) : (
          <Button variant="destructive" disabled={!canPause || saving} onClick={() => setConfirming(true)}>
            <OctagonPause />
            Pause all agents
          </Button>
        )}
      </div>
      {paused && !canResume && <p className="text-sm text-muted-foreground">Only workspace owners can resume agents.</p>}
      {!paused && !canPause && <p className="text-sm text-muted-foreground">Owners and specialists can pause agents.</p>}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause all agents in {workspace.name}?</DialogTitle>
            <DialogDescription>
              Runs in flight are cancelled. Agents won&apos;t start, file proposals or auto-approve anything on any account until an owner
              resumes them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => toggle(true)}>
              <OctagonPause />
              Pause all agents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
