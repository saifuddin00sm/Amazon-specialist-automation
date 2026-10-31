"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSellerContext } from "./seller-context";

export function WorkspaceSwitcher() {
  const { workspaces, workspace, selectWorkspace } = useSellerContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-56 justify-start" aria-label="Switch workspace">
          <Building2 className="text-muted-foreground" />
          <span className="truncate">{workspace?.name ?? "No workspace"}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => selectWorkspace(item.id)}>
            <Building2 />
            <span className="truncate">{item.name}</span>
            {item.id === workspace?.id && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
