import { redirect } from "next/navigation";
import ActivitiesPage from "@/components/forge/scheduling/ActivitiesPage";
import { createClient } from "@/lib/supabase/server";

export default async function SchedulingActivitiesPage({ params }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <ActivitiesPage projectId={projectId} />;
}
