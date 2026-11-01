"use client";

import type { MemberRole, SellerAccount, Workspace } from "@app/core";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** The member acting in a workspace. */
export type ActingMember = { id: string; name: string; role: MemberRole };

type SellerContextValue = {
  workspaces: Workspace[];
  /** Seller accounts in the active workspace. */
  sellerAccounts: SellerAccount[];
  workspace: Workspace | undefined;
  sellerAccount: SellerAccount | undefined;
  /** Who you are in the active workspace; decides which settings you can change. */
  member: ActingMember | undefined;
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
  members = {},
  children,
}: {
  workspaces: Workspace[];
  sellerAccounts: SellerAccount[];
  /** The acting member per workspace id. */
  members?: Record<string, ActingMember>;
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
      // A new account (just connected) isn't selected yet; fall back to the workspace's first.
      sellerAccount: sellerAccounts.find((account) => account.id === sellerAccountId) ?? sellerAccounts[0],
      member: workspaceId ? members[workspaceId] : undefined,
      selectWorkspace: (nextWorkspaceId) => {
        setWorkspaceId(nextWorkspaceId);
        setSellerAccountId(firstAccountIn(allSellerAccounts, nextWorkspaceId));
      },
      selectSellerAccount: setSellerAccountId,
    };
  }, [workspaces, allSellerAccounts, members, workspaceId, sellerAccountId]);

  return <SellerContext value={value}>{children}</SellerContext>;
}

export function useSellerContext(): SellerContextValue {
  const context = useContext(SellerContext);
  if (!context) throw new Error("useSellerContext must be used inside SellerContextProvider");
  return context;
}
