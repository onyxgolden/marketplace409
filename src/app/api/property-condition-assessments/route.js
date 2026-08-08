import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedPropertyConditionAssessmentApplication,
} from "@/lib/supabase/createAuthenticatedPropertyConditionAssessmentApplication";

export async function GET(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyConditionAssessmentApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication.response;
    }

    const propertyId =
      request
        ? new URL(
            request.url,
          ).searchParams.get(
            "propertyId",
          )
        : null;

    const assessments =
      propertyId?.trim()
        ? await authenticatedApplication
            .application
            .listByProperty(
              propertyId,
              authenticatedApplication
                .user.id,
            )
        : await authenticatedApplication
            .application
            .listLatest(
              authenticatedApplication
                .user.id,
            );

    return NextResponse.json({
      success: true,
      assessments,
    });
  } catch (error) {
    console.error(
      "Property condition assessment query error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load property condition assessments.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyConditionAssessmentApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication.response;
    }

    const body =
      await request.json();

    if (
      body?.operation !==
      "record-owner-assessment"
    ) {
      return badRequest(
        "A supported property condition assessment operation is required.",
      );
    }

    if (
      !isObject(
        body.assessment,
      )
    ) {
      return badRequest(
        "assessment is required.",
      );
    }

    const assessment =
      await authenticatedApplication
        .application
        .recordOwnerAssessment(
          body.assessment,
          authenticatedApplication
            .user.id,
        );

    return NextResponse.json({
      success: true,
      assessment,
    });
  } catch (error) {
    console.error(
      "Property condition assessment operation error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete the property condition assessment operation.",
      },
      {
        status: 500,
      },
    );
  }
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
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
