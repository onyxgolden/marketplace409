import { TransactionReviewCollection } from "../../../domains/transaction-review/transaction-review-collection";

export default function Page() {
  const collection = new TransactionReviewCollection({
    items: [],
  });

  return (
    <div style={{ padding: 20 }}>
      <h1>Transaction Review Results</h1>

      <div>
        <p>Total Items: {collection.items.length}</p>
        <p>Needs Review: {collection.needsReviewCount}</p>
        <p>Assigned: {collection.assignedCount}</p>
        <p>Reviewed: {collection.reviewedCount}</p>
        <p>Ignored: {collection.ignoredCount}</p>
      </div>
    </div>
  );
}
