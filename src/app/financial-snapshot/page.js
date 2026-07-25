import FinancialSnapshotTool from "./FinancialSnapshotTool";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export const metadata = {
  title: "Business Financial Snapshot | 409 Marketplace",
  description:
    "Generate a simple business financial snapshot from cash, receivables, debt, revenue, and expenses.",
};

export default async function FinancialSnapshotPage() {
  const forgeApplication =
    await createAuthenticatedForgeApplication();

  if (forgeApplication.response) {
    return forgeApplication.response;
  }

  const forgeApplicationSuite =
    await forgeApplication.getForgeApplicationSuite();

  return (
    <FinancialSnapshotTool
      snapshotApplication={
        forgeApplicationSuite.financialApplicationSuite
          .financialSnapshotViewApplication
      }
    />
  );
}
