import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductTable, type ProductRow } from "@/components/listings/product-table";
import { Skeleton } from "@/components/ui/skeleton";
import { getDataSource } from "@/lib/data";
import { getNavItem } from "@/lib/navigation";

export const metadata: Metadata = { title: "Listings" };

export default function ListingsPage() {
  const { title, description, icon: Icon } = getNavItem("/listings");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon className="size-6 text-muted-foreground" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Products />
      </Suspense>
    </div>
  );
}

/** Every account's products; the table narrows to the account picked in the top bar. */
async function Products() {
  await connection();
  const dataSource = await getDataSource();
  const workspaces = await dataSource.listWorkspaces();
  const accounts = await dataSource.listSellerAccounts();

  const [products, pending] = await Promise.all([
    Promise.all(accounts.map((account) => dataSource.listProducts({ sellerAccountId: account.id }))),
    Promise.all(
      workspaces.map((workspace) =>
        dataSource.listProposals({ workspaceId: workspace.id, status: "pending_approval", type: "listing_update" }),
      ),
    ),
  ]);
  const waiting = new Set(pending.flat().map((proposal) => proposal.target.id));
  const currency = new Map(accounts.map((account) => [account.id, account.currency]));

  const rows: ProductRow[] = products.flat().map((product) => ({
    id: product.id,
    sellerAccountId: product.sellerAccountId,
    title: product.title,
    asin: product.asin,
    sku: product.sku,
    category: product.category,
    status: product.status,
    price: product.price,
    currency: currency.get(product.sellerAccountId) ?? "USD",
    pendingListing: waiting.has(product.id),
  }));

  return <ProductTable rows={rows} />;
}
