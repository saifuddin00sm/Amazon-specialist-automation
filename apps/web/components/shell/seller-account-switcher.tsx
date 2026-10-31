"use client";

import { Check, ChevronsUpDown, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSellerContext } from "./seller-context";

export function SellerAccountSwitcher() {
  const { sellerAccounts, sellerAccount, selectSellerAccount } = useSellerContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-60 justify-start"
          aria-label="Switch seller account"
          disabled={sellerAccounts.length === 0}
        >
          <Store className="text-muted-foreground" />
          <span className="truncate">{sellerAccount?.name ?? "No seller account"}</span>
          {sellerAccount && <Badge variant="secondary">{sellerAccount.marketplace}</Badge>}
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel>Seller accounts</DropdownMenuLabel>
        {sellerAccounts.map((account) => (
          <DropdownMenuItem key={account.id} onSelect={() => selectSellerAccount(account.id)}>
            <Store />
            <span className="truncate">{account.name}</span>
            <Badge variant="outline" className="ml-auto">
              {account.marketplace}
            </Badge>
            <Check className={account.id === sellerAccount?.id ? undefined : "invisible"} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
