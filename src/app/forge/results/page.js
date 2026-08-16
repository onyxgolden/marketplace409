import { TransactionReviewCollection } from "../../../domains/transaction-review/transaction-review-collection";

export default function Page() {
  const collection = new TransactionReviewCollection({
    items: [],
  });

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-950 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-950 shadow-sm">
          <h1 className="text-3xl font-black">Transaction Review Results</h1>

      <div>
        <p>Total Items: {collection.items.length}</p>
        <p>Needs Review: {collection.needsReviewCount}</p>
        <p>Assigned: {collection.assignedCount}</p>
        <p>Reviewed: {collection.reviewedCount}</p>
        <p>Ignored: {collection.ignoredCount}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
