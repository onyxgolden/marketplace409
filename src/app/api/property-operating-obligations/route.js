import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedPropertyOperatingObligationApplication,
} from "@/lib/supabase/createAuthenticatedPropertyOperatingObligationApplication";

function optionalValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).trim() || null;
}

function queryFrom(searchParams) {
  return Object.freeze({
    propertyId:
      optionalValue(
        searchParams.get(
          "propertyId",
        ),
      ),
    scope:
      optionalValue(
        searchParams.get("scope"),
      ),
    obligationType:
      optionalValue(
        searchParams.get(
          "obligationType",
        ),
      ),
    status:
      optionalValue(
        searchParams.get("status"),
      ),
    recognitionStatus:
      optionalValue(
        searchParams.get(
          "recognitionStatus",
        ),
      ),
    unreconciledOnly:
      searchParams.get(
        "unreconciledOnly",
      ) === "true",
  });
}

function requiredString(
  value,
  message,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(message);
  }

  return value.trim();
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

export async function GET(request) {
  try {
    const authenticated =
      await createAuthenticatedPropertyOperatingObligationApplication();

    if (authenticated.response) {
      return authenticated.response;
    }

    const {
      searchParams,
    } = new URL(request.url);
    const query =
      queryFrom(searchParams);
    const periodStart =
      optionalValue(
        searchParams.get(
          "periodStart",
        ),
      );
    const periodEnd =
      optionalValue(
        searchParams.get(
          "periodEnd",
        ),
      );

    if (
      Boolean(periodStart) !==
      Boolean(periodEnd)
    ) {
      return badRequest(
        "Accrual period start and end must be provided together.",
      );
    }

    const obligations =
      await authenticated
        .application
        .list(
          query,
          authenticated.user.id,
        );

    const projection =
      periodStart && periodEnd
        ? await authenticated
            .application
            .buildAccrualProjection({
              ownerId:
                authenticated.user.id,
              periodStart,
              periodEnd,
              query,
            })
        : null;

    return NextResponse.json({
      success: true,
      obligations,
      projection,
    });
  } catch (error) {
    console.error(
      "Property operating obligation query error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to query property operating obligations.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(request) {
  try {
    const authenticated =
      await createAuthenticatedPropertyOperatingObligationApplication();

    if (authenticated.response) {
      return authenticated.response;
    }

    const body =
      await request.json();
    const operation =
      optionalValue(
        body?.operation,
      );

    if (
      operation ===
        "preview-spreadsheet" ||
      operation ===
        "import-spreadsheet"
    ) {
      let csv;

      try {
        csv = requiredString(
          body?.csv,
          "Property operating obligation CSV is required.",
        );
      } catch (error) {
        return badRequest(
          error.message,
        );
      }

      const context =
        await authenticated
          .loadImportContext();

      if (
        operation ===
        "preview-spreadsheet"
      ) {
        const preview =
          authenticated
            .application
            .previewSpreadsheet({
              csv,
              properties:
                context.properties,
              financialEvents:
                context.financialEvents,
              taxServiceYear:
                body?.taxServiceYear ??
                2025,
            });

        return NextResponse.json({
          success:
            preview.valid,
          preview,
        });
      }

      const result =
        await authenticated
          .application
          .importSpreadsheet({
            csv,
            properties:
              context.properties,
            financialEvents:
              context.financialEvents,
            taxServiceYear:
              body?.taxServiceYear ??
              2025,
            ownerId:
              authenticated.user.id,
          });

      return NextResponse.json({
        success: result.valid,
        result,
      });
    }

    if (
      operation ===
        "verify-coverage"
    ) {
      let obligationId;
      let servicePeriodStart;
      let servicePeriodEnd;

      try {
        obligationId =
          requiredString(
            body?.obligationId,
            "Property operating obligation id is required.",
          );
        servicePeriodStart =
          requiredString(
            body?.servicePeriodStart,
            "Property operating obligation coverage start is required.",
          );
        servicePeriodEnd =
          requiredString(
            body?.servicePeriodEnd,
            "Property operating obligation coverage end is required.",
          );
      } catch (error) {
        return badRequest(
          error.message,
        );
      }

      const verification = {
        obligationId,
        servicePeriodStart,
        servicePeriodEnd,
        ownerId:
          authenticated.user.id,
      };

      if (
        Object.prototype.hasOwnProperty.call(
          body,
          "annualAmountCents",
        )
      ) {
        verification.annualAmountCents =
          body.annualAmountCents;
      };

      for (
        const field of [
          "evidenceId",
          "obligationType",
          "providerName",
          "providerReference",
          "notes",
        ]
      ) {
        if (
          Object.prototype.hasOwnProperty.call(
            body,
            field,
          )
        ) {
          verification[field] =
            optionalValue(
              body[field],
            );
        }
      }

      const obligation =
        await authenticated
          .application
          .verifyCoverage(
            verification,
          );

      return NextResponse.json({
        success: true,
        obligation,
      });
    }

    if (
      operation ===
        "reconcile-payment"
    ) {
      let obligationId;
      let financialEventId;

      try {
        obligationId =
          requiredString(
            body?.obligationId,
            "Property operating obligation id is required.",
          );
        financialEventId =
          requiredString(
            body?.financialEventId,
            "Property operating obligation financial event id is required.",
          );
      } catch (error) {
        return badRequest(
          error.message,
        );
      }

      const context =
        await authenticated
          .loadImportContext();

      const ownedEvent =
        context.financialEvents.find(
          (event) =>
            String(event?.id) ===
              financialEventId,
        );

      if (!ownedEvent) {
        return NextResponse.json(
          {
            error:
              "Financial event was not found.",
          },
          {
            status: 404,
          },
        );
      }

      const obligation =
        await authenticated
          .application
          .reconcilePayment({
            obligationId,
            financialEventId,
            ownerId:
              authenticated.user.id,
          });

      return NextResponse.json({
        success: true,
        obligation,
      });
    }

    return badRequest(
      "A supported property operating obligation operation is required.",
    );
  } catch (error) {
    console.error(
      "Property operating obligation mutation error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update property operating obligations.",
      },
      {
        status: 500,
      },
    );
  }
}
