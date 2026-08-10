import {
  NextResponse,
} from "next/server";

import {
  getProgrammerCommand,
} from "@/application/developer/ProgrammerCommandRegistry";

import {
  executeProgrammerCommand,
} from "@/infrastructure/developer/executeProgrammerCommand";

import {
  loadProgrammerAuthorization,
} from "@/lib/supabase/loadProgrammerAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(
  request,
) {
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

    const body =
      await request.json();

    const commandId =
      body?.commandId;

    if (
      typeof commandId !==
        "string" ||
      !getProgrammerCommand(
        commandId,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A valid allowlisted programmer command is required.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      executeProgrammerCommand({
        commandId,
      });

    return NextResponse.json({
      success:
        result.status ===
          "passing",
      result,
    });
  } catch (error) {
    console.error(
      "Programmer command execution error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Programmer command execution failed.",
      },
      {
        status: 500,
      },
    );
  }
}
