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

    const url =
      new URL(request.url);

    const connectionId =
      url.searchParams.get(
        "connectionId",
      );

    if (
      !connectionId ||
      connectionId.trim().length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Connection id is required",
        },
        {
          status: 400,
        },
      );
    }

    const connectionPlatformSuite =
      await authenticatedApplication
        .getConnectionPlatformSuite();

    const intelligence =
      await connectionPlatformSuite
        .connectionOperationsApplication
        .getExecutionHistoryIntelligence({
          ownerId:
            authenticatedApplication.user.id,
          connectionId,
        });

    return NextResponse.json({
      success: true,
      data: intelligence,
    });
  } catch (error) {
    console.error(
      "Connection execution history error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to retrieve connection execution history.";

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
