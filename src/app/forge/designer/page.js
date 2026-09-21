import { redirect } from "next/navigation";
import ProjectsList from "@/components/designer/ProjectsList";
import { createClient } from "@/lib/supabase/server";

export default async function DesignerProjectsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <ProjectsList />;
}
