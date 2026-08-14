import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "./dashboard";

export default async function AuthenticatedDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <Dashboard
    userId={user.id}
    userEmail={user.email ?? ""}
    userName={user.user_metadata?.full_name ?? ""}
    avatarUrl={user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? ""}
  />;
}
