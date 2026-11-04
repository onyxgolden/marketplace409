import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkPackageTakeoffScreen from "@/components/forge/work-management/WorkPackageTakeoffScreen";
import { forgeTheme } from "@/components/forge/theme";

export default async function WorkPackageTakeoffPage({ params }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth");
  const { packageId } = await params;
  return (
    <div className={forgeTheme.page}>
      <div className={forgeTheme.shell}>
        <main className={forgeTheme.main}>
          <WorkPackageTakeoffScreen packageId={packageId} />
        </main>
      </div>
    </div>
  );
}
