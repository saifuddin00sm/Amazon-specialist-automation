"use client";

import type { MemberRole } from "@app/core";
import { Check, ChevronsUpDown, UserRoundCog } from "lucide-react";
import { useTransition } from "react";
import { setViewAs } from "@/app/(app)/view-as-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ViewAsOption } from "@/lib/data";

export const ROLE_NAMES: Record<MemberRole, string> = {
  owner: "Owner",
  specialist: "Specialist",
  client_approver: "Client approver",
  viewer: "Viewer",
};

/**
 * Mock mode only: act as any member to see the app as they would. A client approver sees only their
 * own account, everywhere. With Supabase there is no switcher: you are who you signed in as.
 */
export function ViewAsSwitcher({ current, options }: { current?: string; options: ViewAsOption[] }) {
  const [switching, startTransition] = useTransition();
  const active = options.find((option) => option.id === current);
  const pick = (memberId: string | null) => startTransition(async () => void (await setViewAs({ memberId })));
  const workspaces = [...new Set(options.map((option) => option.workspaceName))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64" aria-label="View as" disabled={switching} data-testid="view-as">
          <UserRoundCog />
          <span className="truncate">{active ? `${active.name} · ${ROLE_NAMES[active.role]}` : "Owner view"}</span>
          <ChevronsUpDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70svh] w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Mock data only: see the app as a member would.
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => pick(null)}>
          Owner view (every workspace)
          {!active && <Check className="ml-auto" />}
        </DropdownMenuItem>
        {workspaces.map((workspace) => (
          <DropdownMenuGroup key={workspace}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{workspace}</DropdownMenuLabel>
            {options
              .filter((option) => option.workspaceName === workspace)
              .map((option) => (
                <DropdownMenuItem key={option.id} onSelect={() => pick(option.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {ROLE_NAMES[option.role]}
                      {option.sellerAccountIds.length > 0 && ` · ${option.sellerAccountIds.length} account`}
                    </span>
                  </span>
                  {option.id === current && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
