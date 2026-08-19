import { notFound, redirect } from "next/navigation";
import ActivitiesPage from "@/components/forge/scheduling/ActivitiesPage";
import { createClient } from "@/lib/supabase/server";

export default async function SchedulingActivitiesPage({ params }) {
  // Still under active development -- held back from the production site until ready,
  // reachable in local dev and preview deploys. Matches the Menu link's own gate in
  // SchedulingBoard.jsx, but enforced here too so navigating straight to the URL can't
  // bypass it.
  if (process.env.VERCEL_ENV === "production") notFound();
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <ActivitiesPage projectId={projectId} />;
}
