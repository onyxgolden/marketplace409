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

export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedConnectionApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const {
      operation,
      connectionId,
      options = {},
    } = await request.json();

    const connectionPlatformSuite =
      await authenticatedApplication
        .getConnectionPlatformSuite();

    const result =
      await connectionPlatformSuite
        .connectionOperationsApplication
        .executeOperation({
          operation,
          connectionId,
          ownerId: authenticatedApplication.user.id,
          options,
        });

    console.log(
      "===== CONNECTION EXECUTION RESULT =====",
      JSON.stringify(result, null, 2),
    );

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "Connection operation execution error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to execute connection operation.";

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
