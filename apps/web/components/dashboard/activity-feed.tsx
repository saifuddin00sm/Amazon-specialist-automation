import type { AgentRunStatus } from "@app/core";
import { Bot } from "lucide-react";
import Link from "next/link";
import type { DashboardActivity } from "@/app/(app)/dashboard/load-dashboard";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AGENT_LABELS, formatDateTime } from "@/lib/format";

const STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** The account's latest agent runs, newest first. */
export function ActivityFeed({ activity }: { activity: DashboardActivity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent activity</CardTitle>
        <CardDescription>The latest runs on this account</CardDescription>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No agent has run on this account yet.</p>
        ) : (
          <ol className="flex flex-col divide-y" data-testid="agent-activity">
            {activity.map((item) => (
              <li key={item.runId} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{AGENT_LABELS[item.agent]}</span>
                    <AIGeneratedBadge actor={{ type: "agent", agent: item.agent, agentRunId: item.runId }} compact />
                    {item.status === "succeeded" ? null : (
                      <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABELS[item.status]}</Badge>
                    )}
                    <time dateTime={item.startedAt} className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(item.startedAt)}
                    </time>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                  {item.product ? (
                    <Link
                      href={`/listings/${item.product.id}`}
                      className="truncate text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                      {item.product.title}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
