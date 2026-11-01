import { readableTextColor, type Branding } from "@app/core";

/**
 * The white-label header of a report: the workspace's logo and name on its primary color, with an
 * accent rule. Text color is picked for contrast, so any primary color stays readable.
 */
export function ReportHeader({
  branding,
  title,
  subtitle,
  period,
}: {
  branding: Branding & { displayName: string };
  title: string;
  subtitle: string;
  period: string;
}) {
  const ink = readableTextColor(branding.primaryColor);
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-t-lg px-6 py-5"
      style={{ background: branding.primaryColor, color: ink, borderBottom: `4px solid ${branding.accentColor}` }}
      data-testid="report-header"
    >
      <div className="flex min-w-0 items-center gap-3">
        {branding.logo && (
          // A data URL or remote logo of any shape; next/image would need a fixed size and a loader.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logo} alt="" className="h-11 w-auto max-w-40 object-contain" />
        )}
        <span className="truncate text-lg font-semibold tracking-tight">{branding.displayName}</span>
      </div>
      <div className="flex flex-col items-end text-right">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-sm opacity-85">{subtitle}</span>
        <span className="text-sm opacity-85 tabular-nums">{period}</span>
      </div>
    </header>
  );
}
