import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedConnectionApplication,
} from "@/lib/supabase/createAuthenticatedConnectionApplication";

export async function GET() {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const connectionPlatformSuite =
      await authenticatedApplication
        .getConnectionPlatformSuite();

    const operations =
      await connectionPlatformSuite
        .connectionOperationsApplication
        .buildConnectionOperations();

    return NextResponse.json({
      success: true,
      data: operations,
    });
  } catch (error) {
    console.error(
      "Connection operations error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build connection operations.";

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
