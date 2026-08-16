import { Sparkles } from "lucide-react";

export default function HomeLaunchBanner() {
  return (
    <div className="bg-amber-500 text-slate-950 text-center px-4 py-3 font-semibold flex items-center justify-center gap-2">
      <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0" />
      409 Marketplace is live — post free local listings, jobs, businesses,
      pets, and investor deals across Southeast Texas.
    </div>
  );
}
