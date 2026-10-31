import type { SellerAccount, Workspace } from "@app/core";

export const workspaces: Workspace[] = [
  { id: "ws_northwind", name: "Northwind Goods" },
  { id: "ws_bluepeak", name: "Bluepeak Outdoors" },
];

export const sellerAccounts: SellerAccount[] = [
  { id: "sa_northwind_us", workspaceId: "ws_northwind", name: "Northwind US", marketplace: "US" },
  { id: "sa_northwind_uk", workspaceId: "ws_northwind", name: "Northwind UK", marketplace: "UK" },
  { id: "sa_northwind_de", workspaceId: "ws_northwind", name: "Northwind DE", marketplace: "DE" },
  { id: "sa_bluepeak_us", workspaceId: "ws_bluepeak", name: "Bluepeak US", marketplace: "US" },
  { id: "sa_bluepeak_ca", workspaceId: "ws_bluepeak", name: "Bluepeak CA", marketplace: "CA" },
];
