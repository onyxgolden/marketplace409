import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedPropertyHVACApplication,
} from "@/lib/supabase/createAuthenticatedPropertyHVACApplication";

export async function GET(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyHVACApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication.response;
    }

    const searchParams =
      new URL(
        request.url,
      ).searchParams;

    const systemId =
      searchParams.get(
        "systemId",
      );

    if (systemId?.trim()) {
      const history =
        await authenticatedApplication
          .application
          .getSystemHistory(
            systemId,
            authenticatedApplication
              .user.id,
          );

      if (!history) {
        return NextResponse.json(
          {
            error:
              "HVAC system was not found.",
          },
          {
            status: 404,
          },
        );
      }

      return NextResponse.json({
        success: true,
        history,
      });
    }

    const propertyId =
      searchParams.get(
        "propertyId",
      );

    if (!propertyId?.trim()) {
      return badRequest(
        "propertyId or systemId is required.",
      );
    }

    const systems =
      await authenticatedApplication
        .application
        .listSystems(
          propertyId,
          authenticatedApplication
            .user.id,
        );

    return NextResponse.json({
      success: true,
      systems,
    });
  } catch (error) {
    console.error(
      "Property HVAC query error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load property HVAC records.",
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
      await createAuthenticatedPropertyHVACApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication.response;
    }

    const body =
      await request.json();

    const {
      application,
      user,
    } = authenticatedApplication;

    switch (body?.operation) {
      case "save-system": {
        if (!isObject(body.system)) {
          return badRequest(
            "system is required.",
          );
        }

        const system =
          await application.saveSystem(
            body.system,
            user.id,
          );

        return NextResponse.json({
          success: true,
          system,
        });
      }

      case "save-component": {
        if (
          !isObject(
            body.component,
          )
        ) {
          return badRequest(
            "component is required.",
          );
        }

        const component =
          await application
            .saveComponent(
              body.component,
              user.id,
            );

        return NextResponse.json({
          success: true,
          component,
        });
      }

      case "record-component-event": {
        if (!isObject(body.event)) {
          return badRequest(
            "event is required.",
          );
        }

        const evidenceId =
          typeof body.evidenceId ===
            "string" &&
          body.evidenceId.trim()
            ? body.evidenceId.trim()
            : null;

        const event =
          evidenceId
            ? await application
                .recordComponentEvent(
                  body.event,
                  user.id,
                  evidenceId,
                )
            : await application
                .recordComponentEvent(
                  body.event,
                  user.id,
                );

        return NextResponse.json({
          success: true,
          event,
        });
      }

      default:
        return badRequest(
          "A supported property HVAC operation is required.",
        );
    }
  } catch (error) {
    console.error(
      "Property HVAC operation error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete the property HVAC operation.",
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
