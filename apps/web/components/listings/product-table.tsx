"use client";

import type { Currency, ProductStatus } from "@app/core";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";

export type ProductRow = {
  id: string;
  sellerAccountId: string;
  title: string;
  asin: string;
  sku: string;
  category: string;
  status: ProductStatus;
  price: number;
  currency: Currency;
  /** A listing proposal is waiting for approval. */
  pendingListing: boolean;
};

/** Products of the seller account picked in the top bar, searchable by title, ASIN or SKU. */
export function ProductTable({ rows }: { rows: ProductRow[] }) {
  const { sellerAccount } = useSellerContext();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      row.sellerAccountId === sellerAccount?.id &&
      (needle === "" || [row.title, row.asin, row.sku].some((value) => value.toLowerCase().includes(needle))),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, ASIN or SKU"
            aria-label="Search products"
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {visible.length} {visible.length === 1 ? "product" : "products"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((row) => (
              <tr key={row.id} className="hover:bg-muted/50">
                <td className="max-w-md px-3 py-2">
                  <Link href={`/listings/${row.id}`} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {row.asin} · {row.sku}
                    </span>
                    {row.pendingListing && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                        Proposal waiting
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.category}</td>
                <td className="px-3 py-2">
                  <Badge variant={row.status === "active" ? "outline" : "destructive"} className="capitalize">
                    {row.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.price, row.currency)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
