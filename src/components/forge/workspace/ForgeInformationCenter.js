import ForgeAlerts from "@/components/forge/ForgeAlerts";
import ForgeInsights from "@/components/forge/ForgeInsights";
import ForgeQuickActions from "@/components/forge/ForgeQuickActions";
import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";

export default function ForgeInformationCenter({
  alerts,
  insights,
  recentActivities,
  setView,
}) {
  return (
    <aside className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <header className="border-b border-slate-800 bg-slate-950 p-5 text-white">
          <div className="text-xs font-black uppercase tracking-[0.24em] text-amber-400">
            Information Center
          </div>

          <h2 className="mt-2 text-xl font-black">
            Decisions, alerts, and activity
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-300">
            Persistent operational context for the active workbench.
          </p>
        </header>

        <div className="max-h-[calc(100vh-13rem)] space-y-7 overflow-y-auto p-5">
          <ForgeQuickActions setView={setView} variant="embedded" />

          <ForgeAlerts alerts={alerts} variant="embedded" />

          <ForgeRecentActivity
            activities={recentActivities}
            variant="embedded"
          />

          <ForgeInsights insights={insights} variant="embedded" />
        </div>
      </section>
    </aside>
  );
}
