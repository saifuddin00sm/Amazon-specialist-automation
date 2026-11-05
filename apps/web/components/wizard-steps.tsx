import { cn } from "cn";

/** A wizard's numbered steps, with the current one marked for assistive tech. */
export function WizardSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs tabular-nums",
              i < current && "border-primary bg-primary text-primary-foreground",
              i === current && "border-primary text-primary",
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === current ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
