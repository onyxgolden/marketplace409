import { createFinancialSnapshotApplication } from "@/infrastructure/composition";

export async function GET() {
  const application = await createFinancialSnapshotApplication();
  const { reports, dashboard } = application.buildDashboardReports();

  return Response.json({
    success: true,
    data: {
      reports,
      dashboard,
    },
  });
}
