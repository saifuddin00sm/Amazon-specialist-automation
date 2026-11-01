import type { Metadata } from "next";
import { AutonomyForm } from "@/components/settings/autonomy-form";
import { KillSwitch } from "@/components/settings/kill-switch";

export const metadata: Metadata = { title: "Agent settings" };

/** The kill switch for the selected workspace and autonomy for the selected account. */
export default function AgentSettingsPage() {
  return (
    <>
      <KillSwitch />
      <AutonomyForm />
    </>
  );
}
