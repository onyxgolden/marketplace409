import { createFinancialSnapshotApplication } from "@/infrastructure/composition";

export async function GET() {
  try {
    const application = await createFinancialSnapshotApplication();
    const { reports, dashboard } = await application.captureDashboardSnapshot();

    return Response.json({
      success: true,
      data: {
        reports,
        dashboard,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
