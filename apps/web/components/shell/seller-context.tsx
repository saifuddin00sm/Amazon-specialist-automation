"use client";

import type { SellerAccount, Workspace } from "@app/core";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type SellerContextValue = {
  workspaces: Workspace[];
  /** Seller accounts in the active workspace. */
  sellerAccounts: SellerAccount[];
  workspace: Workspace | undefined;
  sellerAccount: SellerAccount | undefined;
  selectWorkspace: (workspaceId: string) => void;
  selectSellerAccount: (sellerAccountId: string) => void;
};

const SellerContext = createContext<SellerContextValue | null>(null);

function firstAccountIn(accounts: SellerAccount[], workspaceId: string | undefined) {
  return accounts.find((account) => account.workspaceId === workspaceId)?.id;
}

export function SellerContextProvider({
  workspaces,
  sellerAccounts: allSellerAccounts,
  children,
}: {
  workspaces: Workspace[];
  sellerAccounts: SellerAccount[];
  children: ReactNode;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id);
  const [sellerAccountId, setSellerAccountId] = useState(() =>
    firstAccountIn(allSellerAccounts, workspaces[0]?.id),
  );

  const value = useMemo<SellerContextValue>(() => {
    const sellerAccounts = allSellerAccounts.filter((account) => account.workspaceId === workspaceId);
    return {
      workspaces,
      sellerAccounts,
      workspace: workspaces.find((workspace) => workspace.id === workspaceId),
      sellerAccount: sellerAccounts.find((account) => account.id === sellerAccountId),
      selectWorkspace: (nextWorkspaceId) => {
        setWorkspaceId(nextWorkspaceId);
        setSellerAccountId(firstAccountIn(allSellerAccounts, nextWorkspaceId));
      },
      selectSellerAccount: setSellerAccountId,
    };
  }, [workspaces, allSellerAccounts, workspaceId, sellerAccountId]);

  return <SellerContext value={value}>{children}</SellerContext>;
}

export function useSellerContext(): SellerContextValue {
  const context = useContext(SellerContext);
  if (!context) throw new Error("useSellerContext must be used inside SellerContextProvider");
  return context;
}
