import FinancialSnapshotTool from "./FinancialSnapshotTool";

export const metadata = {
  title: "Business Financial Snapshot | 409 Marketplace",
  description:
    "Generate a simple business financial snapshot from cash, receivables, debt, revenue, and expenses.",
};

export default function FinancialSnapshotPage() {
  return <FinancialSnapshotTool />;
}
