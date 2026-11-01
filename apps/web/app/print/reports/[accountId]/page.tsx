import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadReportFor } from "@/app/(app)/reports/load-report";
import { PrintControls } from "@/components/reports/print-controls";
import { ReportDocument, formatWeek } from "@/components/reports/report-document";
import { Skeleton } from "@/components/ui/skeleton";

// White-label: the app's name stays out of the tab and the PDF. PrintControls sets the real title.
export const metadata: Metadata = { title: { absolute: "Weekly report" } };

/**
 * The report alone, outside the app shell, sized for A4. `?print=1` opens the print dialog as soon
 * as it has loaded, so one click on the Reports page ends in a PDF.
 */
export default function PrintReportPage({ params, searchParams }: PageProps<"/print/reports/[accountId]">) {
  return (
    <div className="min-h-svh bg-muted py-6 print:bg-white print:py-0">
      <Suspense fallback={<Skeleton className="mx-auto h-[297mm] max-w-[210mm]" />}>
        <PrintableReport params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PrintableReport({ params, searchParams }: Pick<PageProps<"/print/reports/[accountId]">, "params" | "searchParams">) {
  await connection();
  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const week = typeof query.week === "string" ? query.week : undefined;
  const loaded = await loadReportFor(accountId, week);
  if (!loaded?.report) notFound();
  const { report } = loaded;

  return (
    <>
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 print:hidden">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Reports
        </Link>
        <PrintControls title={`${report.account.name} weekly report, ${formatWeek(report.week)}`} auto={query.print === "1"} />
      </div>
      <ReportDocument report={report} />
    </>
  );
}
