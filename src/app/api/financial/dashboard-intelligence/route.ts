import { NextResponse } from "next/server";

import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedForgeApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const { canonicalIntelligenceContextBuilder } =
      await authenticatedApplication.getForgeApplicationSuite();

    const intelligence =
      await canonicalIntelligenceContextBuilder.build({
        ownerId: authenticatedApplication.user.id,
      });

    return NextResponse.json({
      success: true,
      data:
        typeof intelligence?.toJSON === "function"
          ? intelligence.toJSON()
          : intelligence,
    });
  } catch (error) {
    console.error("Financial dashboard intelligence error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial dashboard intelligence.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
