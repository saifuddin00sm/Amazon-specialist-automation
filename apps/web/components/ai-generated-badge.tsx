import { isAgentProduced, type Actor } from "@app/core";
import { cn } from "cn";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AGENT_LABELS } from "@/lib/format";

/** Marks anything an agent produced. Renders nothing for members and the system. */
export function AIGeneratedBadge({ actor, compact, className }: { actor: Actor; compact?: boolean; className?: string }) {
  if (!isAgentProduced(actor)) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(compact && "px-1.5", "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300", className)}
          data-testid="ai-generated-badge"
        >
          <Sparkles aria-hidden />
          {compact ? <span className="sr-only">AI generated</span> : "AI generated"}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {AGENT_LABELS[actor.agent]} agent · run {actor.agentRunId}
      </TooltipContent>
    </Tooltip>
  );
}
