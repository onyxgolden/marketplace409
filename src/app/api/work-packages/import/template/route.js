// Work Package Planner file import — template download.
//
// A plain CSV with the exact columns for one grid, plus one example
// row. No auth: the template carries no user data, only column names,
// and the dialog links it as a plain download.
import { NextResponse } from "next/server";
import {
  PACKAGE_IMPORT_COLUMNS,
  STEP_IMPORT_COLUMNS,
} from "@/domains/work-management/workPackageImport";

const EXAMPLE_ROWS = {
  packages: "Kitchen remodel,draft,4800 Kent Ave,remodel,2026-11-10,2026-11-30,Full kitchen remodel,",
  steps: "1,Fabricate pipe spool,Cut and fit the spool,Pipefitter,3,24,",
};

export async function GET(request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "packages" && kind !== "steps") {
    return NextResponse.json({ error: "kind must be packages or steps." }, { status: 400 });
  }
  const columns = kind === "packages" ? PACKAGE_IMPORT_COLUMNS : STEP_IMPORT_COLUMNS;
  const csv = `${columns.map((column) => column.header).join(",")}\n${EXAMPLE_ROWS[kind]}\n`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="work-${kind}-import-template.csv"`,
    },
  });
}
