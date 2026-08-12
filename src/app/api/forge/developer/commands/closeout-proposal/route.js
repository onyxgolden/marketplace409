import {
  NextResponse,
} from "next/server";

import {
  buildSessionCloseoutProposal,
} from "../../../../../../../scripts/governance/buildSessionCloseoutProposal.mjs";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const authorization =
      await loadProgrammerAuthorization();

    if (
      !authorization.ok
    ) {
      return NextResponse.json(
        {
          error:
            authorization.message ||
            "Programmer authorization failed.",
        },
        {
          status: 500,
        },
      );
    }

    if (
      !authorization.authorized
    ) {
      return NextResponse.json(
        {
          error:
            "Programmer authorization is required.",
        },
        {
          status: 403,
        },
      );
    }

    if (
      process.env.VERCEL === "1"
    ) {
      return NextResponse.json(
        {
          error:
            "Session closeout proposals are disabled on Vercel. Run this dashboard from the authorized local FORGE workstation.",
        },
        {
          status: 400,
        },
      );
    }

    const proposal =
      buildSessionCloseoutProposal();

    return NextResponse.json({
      proposal,
    });
  } catch (error) {
    console.error(
      "Session closeout proposal error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Session closeout proposal failed.",
      },
      {
        status: 500,
      },
    );
  }
}
