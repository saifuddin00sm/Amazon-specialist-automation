import { LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import type { SignedInUser } from "@/lib/data";

/** Who is signed in, with a way out. Only shown with DATA_SOURCE=supabase. */
export function UserMenu({ user }: { user: SignedInUser }) {
  return (
    <form action={signOut} className="flex items-center gap-1">
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline" title={user.email}>
        {user.email}
      </span>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
        <LogOut />
      </Button>
    </form>
  );
}
