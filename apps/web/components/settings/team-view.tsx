"use client";

import { MemberRoleSchema, type Member, type MemberRole } from "@app/core";
import { Loader2, PencilLine, Trash2, UserPlus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { inviteMember, removeMember, updateMember } from "@/app/(app)/settings/actions";
import { useSellerContext } from "@/components/shell/seller-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { OwnersOnlyNote, SettingsSection } from "./settings-tabs";

export const ROLE_LABELS: Record<MemberRole, { label: string; detail: string }> = {
  owner: { label: "Owner", detail: "Everything, including settings, team and the kill switch." },
  specialist: { label: "Specialist", detail: "Runs agents and decides proposals on every account; can pause agents." },
  client_approver: { label: "Client approver", detail: "Decides proposals on the accounts picked below, and nothing else." },
  viewer: { label: "Viewer", detail: "Reads everything, changes nothing." },
};

type Editing = { mode: "invite" } | { mode: "edit"; member: Member };

/** The workspace's members and their roles. Owners invite, change and remove members. */
export function TeamView({ members: byWorkspace }: { members: Record<string, Member[]> }) {
  const { workspace, sellerAccounts, member: me } = useSellerContext();
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<Member>();
  const [saving, startTransition] = useTransition();
  if (!workspace) return null;

  const members = byWorkspace[workspace.id] ?? [];
  const canEdit = me?.role === "owner";
  const accountName = new Map(sellerAccounts.map((account) => [account.id, account.name]));

  const remove = (target: Member) =>
    startTransition(async () => {
      const result = await removeMember({ workspaceId: workspace.id, targetMemberId: target.id });
      setRemoving(undefined);
      if (result.ok) toast.success(`Removed ${target.name}`);
      else toast.error(result.message);
    });

  return (
    <SettingsSection
      title="Team"
      description={`People in ${workspace.name} and what they can do. Members sign in with a magic link to their email.`}
      aside={
        canEdit && (
          <Button onClick={() => setEditing({ mode: "invite" })}>
            <UserPlus />
            Invite member
          </Button>
        )
      }
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="team">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Accounts</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {members.map((member) => {
              const self = member.id === me?.id;
              return (
                <tr key={member.id} data-member={member.email}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{member.name}</span>
                    {self && (
                      <Badge variant="secondary" className="ml-2">
                        You
                      </Badge>
                    )}
                    <span className="block text-xs text-muted-foreground">{member.email}</span>
                  </td>
                  <td className="px-3 py-2">{ROLE_LABELS[member.role].label}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {member.sellerAccountIds.length === 0
                      ? "All accounts"
                      : member.sellerAccountIds.map((id) => accountName.get(id) ?? id).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDateTime(member.createdAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canEdit && !self && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${member.name}`} onClick={() => setEditing({ mode: "edit", member })}>
                          <PencilLine />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${member.name}`} onClick={() => setRemoving(member)}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <OwnersOnlyNote canEdit={canEdit} what="manage the team" />

      {editing && (
        <MemberDialog key={editing.mode === "edit" ? editing.member.id : "invite"} editing={editing} workspaceId={workspace.id} onClose={() => setEditing(undefined)} />
      )}

      <Dialog open={removing !== undefined} onOpenChange={(open) => !open && setRemoving(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              They lose access to {workspace.name} right away. Their past decisions stay in the audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(undefined)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => removing && remove(removing)}>
              {saving && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function MemberDialog({ editing, workspaceId, onClose }: { editing: Editing; workspaceId: string; onClose: () => void }) {
  const { sellerAccounts } = useSellerContext();
  const existing = editing.mode === "edit" ? editing.member : undefined;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>(existing?.role ?? "specialist");
  const [accounts, setAccounts] = useState<string[]>(existing?.sellerAccountIds ?? []);
  const [error, setError] = useState<string>();
  const [saving, startTransition] = useTransition();
  const id = useId();
  const needsAccounts = role === "client_approver";

  const submit = () =>
    startTransition(async () => {
      const sellerAccountIds = needsAccounts ? accounts : [];
      const result = existing
        ? await updateMember({ workspaceId, targetMemberId: existing.id, role, sellerAccountIds })
        : await inviteMember({ workspaceId, name, email, role, sellerAccountIds });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success(existing ? `Updated ${existing.name}` : `Invited ${name.trim()}`);
      onClose();
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : "Invite a member"}</DialogTitle>
          <DialogDescription>
            {existing ? existing.email : "They get access as soon as they sign in with a magic link sent to this email."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {!existing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-email`}>Email</Label>
                <Input id={`${id}-email`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-role`}>Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
              <SelectTrigger id={`${id}-role`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MemberRoleSchema.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_LABELS[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[role].detail}</p>
          </div>
          {needsAccounts && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Accounts they approve for</legend>
              {sellerAccounts.map((account) => (
                <label key={account.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={accounts.includes(account.id)}
                    onCheckedChange={(checked) =>
                      setAccounts((current) => (checked === true ? [...current, account.id] : current.filter((candidate) => candidate !== account.id)))
                    }
                  />
                  {account.name}
                </label>
              ))}
            </fieldset>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (needsAccounts && accounts.length === 0) || (!existing && (!name.trim() || !email.trim()))}>
              {saving && <Loader2 className="animate-spin" />}
              {existing ? "Save" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
