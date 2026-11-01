"use client";

import { Palette, Printer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountReport } from "@/app/(app)/reports/load-report";
import { useSellerContext } from "@/components/shell/seller-context";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportDocument, formatWeek } from "./report-document";

/** The weekly report of the account picked in the top bar: pick a week, preview it, print it. */
export function ReportsView({ reports }: { reports: Record<string, AccountReport> }) {
  const { sellerAccount } = useSellerContext();
  const router = useRouter();
  const current = sellerAccount ? reports[sellerAccount.id] : undefined;
  const report = current?.report;

  if (!sellerAccount || !current || !report) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Reports appear once Amazon has reported a full week of metrics for this account.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={report.week.to} onValueChange={(to) => router.push(`/reports?week=${to}`)}>
          <SelectTrigger size="sm" aria-label="Week" className="min-w-56">
            <span className="text-muted-foreground">Week:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {current.weeks.map((week) => (
              <SelectItem key={week.to} value={week.to}>
                {formatWeek(week)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings/branding">
            <Palette />
            Branding
          </Link>
        </Button>
        <Button asChild className="ml-auto">
          {/* Opens the print view, which opens the print dialog once it has loaded. */}
          <a href={`/print/reports/${sellerAccount.id}?week=${report.week.to}&print=1`} target="_blank" rel="noopener">
            <Printer />
            Print report
          </a>
        </Button>
      </div>
      <div className="rounded-xl bg-muted p-3 sm:p-6">
        <ReportDocument report={report} />
      </div>
    </div>
  );
}
