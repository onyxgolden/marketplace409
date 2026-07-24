import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

export async function GET(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const {
      searchParams,
    } = new URL(request.url);

    const connectionPlatformSuite =
      await authenticatedApplication.getConnectionPlatformSuite();

    const [
      dashboard,
      reports,
    ] = await Promise.all([
      searchParams.get("dashboard") === "true"
        ? connectionPlatformSuite
            .connectionReadModelApplication
            .buildConnectionDashboard()
        : Promise.resolve(null),

      searchParams.get("reports") === "true"
        ? connectionPlatformSuite
            .connectionReadModelApplication
            .buildConnectionReports()
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        dashboard,
        reports,
      },
    });
  } catch (error) {
    console.error(
      "Connection read models error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build connection read models.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
