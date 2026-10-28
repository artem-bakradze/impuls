import { SettingsView } from "@/components/settings/SettingsView";
import { buildSettings } from "@/lib/server/settings";
import { requireLaunchedBusiness } from "@/lib/server/session";

export default async function SettingsPage() {
  const { business } = await requireLaunchedBusiness();
  return <SettingsView model={await buildSettings(business)} />;
}
