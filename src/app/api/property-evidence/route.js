import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedPropertyEvidenceApplication,
} from "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication";

export async function GET(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyEvidenceApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication.response;
    }

    const searchParams =
      new URL(
        request.url,
      ).searchParams;

    const propertyId =
      requiredQueryValue(
        searchParams,
        "propertyId",
      );

    if (!propertyId) {
      return badRequest(
        "propertyId is required.",
      );
    }

    const evidence =
      await authenticatedApplication
        .application
        .listEvidence(
          {
            propertyId,
            hvacSystemId:
              optionalQueryValue(
                searchParams,
                "hvacSystemId",
              ),
            hvacEventId:
              optionalQueryValue(
                searchParams,
                "hvacEventId",
              ),
            reviewStatus:
              optionalQueryValue(
                searchParams,
                "reviewStatus",
              ),
          },
          authenticatedApplication
            .user.id,
        );

    return NextResponse.json({
      success: true,
      evidence,
    });
  } catch (error) {
    console.error(
      "Property evidence query error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load property evidence.",
      },
      {
        status: 500,
      },
    );
  }
}

function requiredQueryValue(
  searchParams,
  name,
) {
  return (
    searchParams
      .get(name)
      ?.trim() || null
  );
}

function optionalQueryValue(
  searchParams,
  name,
) {
  return requiredQueryValue(
    searchParams,
    name,
  );
}

function badRequest(message) {
  return NextResponse.json(
    {
      error: message,
    },
    {
      status: 400,
    },
  );
}
