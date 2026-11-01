import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ConnectionsView } from "@/components/settings/connections-view";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource } from "@/lib/data";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 max-w-4xl" />}>
      <Connections />
    </Suspense>
  );
}

/** The newest day each account has data for; the accounts themselves come from the shell. */
async function Connections() {
  await connection();
  const dataSource = await getDataSource();
  const accounts = await dataSource.listSellerAccounts();
  const ranges = await Promise.all(accounts.map((account) => dataSource.getMetricsDateRange(account.id)));
  return <ConnectionsView lastData={Object.fromEntries(accounts.map((account, i) => [account.id, ranges[i]?.to]))} />;
}
