import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChartBuilderPage from "@/components/chartBuilder/ChartBuilderPage";

export const metadata = {
  title: "Chart Builder | FORGE",
  description: "Build organization charts and workflow charts from templates or spreadsheets.",
};

export default async function ChartsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  return <ChartBuilderPage />;
}
