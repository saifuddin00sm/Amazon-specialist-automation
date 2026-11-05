"use client";

import { hasBlockingFailure, newCampaignPath, newListingPath, type AgentRun, type AgentRunStep } from "@app/core";
import { cn } from "cn";
import { Check, CircleDashed, FastForward, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AIGeneratedBadge } from "@/components/ai-generated-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AGENT_LABELS, formatDateTime } from "@/lib/format";

/** Characters revealed per tick, and the tick length. About 200 characters a second. */
const CHARS_PER_TICK = 6;
const TICK_MS = 30;
/** Ticks to rest on a finished step before the next one starts. */
const DWELL_TICKS = 12;

type Playback = { step: number; chars: number; dwell: number; playing: boolean };

const NO_STEPS: AgentRunStep[] = [];

/**
 * Replays an AgentRun's steps as a vertical timeline, streaming each step's text the way the agent
 * produced it. `autoPlay` starts from the first step; otherwise the finished timeline shows at once.
 */
export function AgentRunViewer({
  run,
  autoPlay = false,
  onPlaybackEnd,
}: {
  run: AgentRun;
  autoPlay?: boolean;
  /** Called once, the first time playback reaches the end. */
  onPlaybackEnd?: () => void;
}) {
  const steps = run.steps ?? NO_STEPS;
  const [playback, setPlayback] = useState<Playback>(() =>
    autoPlay ? { step: 0, chars: 0, dwell: 0, playing: true } : { step: steps.length, chars: 0, dwell: 0, playing: false },
  );
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const ended = useRef(false);

  useEffect(() => {
    if (!playback.playing) return;
    const timer = window.setInterval(() => {
      setPlayback((current) => advance(current, steps, reducedMotion));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playback.playing, steps, reducedMotion]);

  const done = playback.step >= steps.length;
  useEffect(() => {
    if (done && autoPlay && !ended.current) {
      ended.current = true;
      onPlaybackEnd?.();
    }
  }, [done, autoPlay, onPlaybackEnd]);

  const current = steps[playback.step];

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4" aria-label="Agent run" data-testid="agent-run-viewer">
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-semibold">
            {AGENT_LABELS[run.agent]} · <span className="font-normal text-muted-foreground">{run.id}</span>
          </h3>
          <p className="text-xs text-muted-foreground">Started {formatDateTime(run.startedAt)}</p>
        </div>
        <RunStatusBadge run={run} playing={!done} />
        <AIGeneratedBadge actor={{ type: "agent", agent: run.agent, agentRunId: run.id }} />
        <div className="ml-auto flex items-center gap-1">
          {!done ? (
            <Button size="sm" variant="ghost" onClick={() => setPlayback({ step: steps.length, chars: 0, dwell: 0, playing: false })}>
              <FastForward />
              Skip
            </Button>
          ) : (
            steps.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPlayback({ step: 0, chars: 0, dwell: 0, playing: true })}>
                <RotateCcw />
                Replay
              </Button>
            )
          )}
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {done ? "Run replay finished." : current ? `${current.title} in progress.` : ""}
      </p>

      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{run.summary || "This run didn't record a timeline."}</p>
      ) : (
        <ol className="flex flex-col">
          {steps.map((step, i) => {
            const state = i < playback.step ? "done" : i === playback.step ? "active" : "pending";
            const text = state === "done" ? step.text : state === "active" ? step.text.slice(0, playback.chars) : "";
            return (
              <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0" data-step-kind={step.kind} data-state={state}>
                {i < steps.length - 1 && (
                  <span
                    aria-hidden
                    className={cn("absolute top-7 bottom-0 left-3.5 w-px", state === "done" ? "bg-primary/40" : "bg-border")}
                  />
                )}
                <StepIcon state={state} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-sm font-medium", state === "pending" && "text-muted-foreground")}>{step.title}</span>
                    {"agent" in step && state !== "pending" && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {AGENT_LABELS[step.agent]}
                      </Badge>
                    )}
                    {state === "done" && <StepOutcome step={step} run={run} />}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{stepSeconds(step)}s</span>
                  </div>
                  {state !== "pending" && (
                    <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {text}
                      {state === "active" && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function advance(current: Playback, steps: AgentRunStep[], reducedMotion: boolean): Playback {
  const step = steps[current.step];
  if (!step) return { ...current, playing: false };
  if (current.chars < step.text.length) {
    // Reduced motion shows each step whole instead of streaming it.
    return { ...current, chars: reducedMotion ? step.text.length : current.chars + CHARS_PER_TICK };
  }
  if (current.dwell < DWELL_TICKS) return { ...current, dwell: current.dwell + 1 };
  const next = current.step + 1;
  return { step: next, chars: 0, dwell: 0, playing: next < steps.length };
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "active" && "border-primary text-primary",
      )}
    >
      {state === "done" ? (
        <Check className="size-4" aria-label="Done" />
      ) : state === "active" ? (
        <Loader2 className="size-4 animate-spin" aria-label="In progress" />
      ) : (
        <CircleDashed className="size-4 text-muted-foreground" aria-label="Pending" />
      )}
    </span>
  );
}

function StepOutcome({ step, run }: { step: AgentRunStep; run: AgentRun }) {
  switch (step.kind) {
    case "review":
      return (
        <Badge
          variant="outline"
          className={cn(
            "tabular-nums",
            step.overall >= 80
              ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/40 text-amber-700 dark:text-amber-300",
          )}
        >
          Score {step.overall}
        </Badge>
      );
    case "compliance_check":
      return hasBlockingFailure(step.checks) ? (
        <Badge variant="destructive">{step.checks.filter((check) => check.status === "fail").length} blocking</Badge>
      ) : (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
          Passed
        </Badge>
      );
    case "awaiting_approval":
      return step.proposalId ? (
        <Button asChild size="xs" variant="outline">
          <Link href={`/approvals?proposal=${step.proposalId}`}>Open in Approvals</Link>
        </Button>
      ) : run.status === "running" ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Filing proposal
        </span>
      ) : null;
    case "plan": {
      // The first pass only reads; the others report what they found. A strategist's or creator's brief isn't a change.
      const noun = step.agent === "campaign_strategist" ? "campaign" : step.agent === "listing_creator" ? "attribute" : "change";
      const brief = step.agent === "campaign_strategist" ? newCampaignPath.brief : step.agent === "listing_creator" ? newListingPath.brief : undefined;
      const count = step.changes.filter((change) => change.path !== brief).length;
      return count > 0 ? (
        <Badge variant="outline" className="tabular-nums">
          {count} {count === 1 ? noun : `${noun}s`}
        </Badge>
      ) : null;
    }
    case "draft":
      return null;
  }
}

function RunStatusBadge({ run, playing }: { run: AgentRun; playing: boolean }) {
  if (playing) return <Badge variant="secondary">Replaying</Badge>;
  switch (run.status) {
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "succeeded":
      return (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
          Succeeded
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="outline">{run.status}</Badge>;
  }
}

function stepSeconds(step: AgentRunStep): number {
  return Math.round((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000);
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
