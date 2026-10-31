"use client";

import { DECISION_NOTE_MAX_LENGTH } from "@app/core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const REASON_PRESETS = [
  "Doesn't match our brand voice.",
  "Claims aren't backed by ProductFacts.",
  "Hold until the current promotion ends.",
  "Spend is frozen this month.",
];

/** Reject needs a reason; submit stays disabled until there is one. */
export function RejectForm({
  count = 1,
  onSubmit,
  onCancel,
}: {
  count?: number;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length > 0;
  const submit = () => {
    if (valid) onSubmit(reason.trim());
  };

  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Reject proposal"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Label htmlFor="reject-reason">
        Why reject {count === 1 ? "this proposal" : `${count} proposals`}? <span className="text-destructive">*</span>
      </Label>
      <Textarea
        id="reject-reason"
        value={reason}
        required
        autoFocus
        rows={3}
        maxLength={DECISION_NOTE_MAX_LENGTH}
        placeholder="The agent learns from this. Be specific."
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex flex-wrap gap-1.5">
        {REASON_PRESETS.map((preset) => (
          <Button key={preset} type="button" variant="outline" size="xs" onClick={() => setReason(preset)}>
            {preset}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" disabled={!valid}>
          Reject{count > 1 ? ` ${count}` : ""}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Ctrl+Enter to submit</span>
      </div>
    </form>
  );
}
