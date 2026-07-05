import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET() {
  try {
    const { snapshotApplication } = await createFinancialApplicationSuite();

    const { reports, dashboard } =
      await snapshotApplication.captureDashboardSnapshot();

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
      { status: 500 },
    );
  }
}
