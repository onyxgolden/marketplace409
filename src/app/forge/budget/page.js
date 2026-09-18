import BudgetPanel from "@/components/forge/budget/BudgetPanel";

export default function BudgetPage() {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-100 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <BudgetPanel />
      </div>
    </main>
  );
}
