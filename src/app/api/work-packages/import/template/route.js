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

// Package example rows, one per Industrial/Commercial mode selector
// mode — aligned to PACKAGE_IMPORT_COLUMNS' live 9-column order (Title,
// Package #, Status, Property, Scope, Planned start, Planned finish,
// Description, Source record ID). Package # is always blank: numbers
// are server-assigned, never imported. Industrial mode has no Property
// (it uses Unit/Area/System instead, which the import layer does not
// cover — see the mode-selector scope brief); Commercial mode has no
// industrial-only fields to show here either way, since the packages
// import grid carries no unit/area/system columns at all.
const PACKAGE_EXAMPLE_ROWS_BY_MODE = {
  industrial: "Fabricate pipe spool,,draft,,engineering,2026-11-10,2026-11-30,Fabricate and fit spool per isometric,",
  commercial: "Kitchen remodel,,draft,4800 Kent Ave,remodel,2026-11-10,2026-11-30,Full kitchen remodel,",
};

const STEP_EXAMPLE_ROW = "1,Fabricate pipe spool,Cut and fit the spool,Pipefitter,3,24,";

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "packages" && kind !== "steps") {
    return NextResponse.json({ error: "kind must be packages or steps." }, { status: 400 });
  }
  const columns = kind === "packages" ? PACKAGE_IMPORT_COLUMNS : STEP_IMPORT_COLUMNS;
  let exampleRow;
  if (kind === "packages") {
    // Mode defaults to industrial (the planner's primary purpose), same
    // default as a newly created package — not required: a template
    // download with no ?mode= still returns a valid, correctly aligned
    // example rather than erroring.
    const modeParam = params.get("mode");
    const mode = modeParam === "commercial" ? "commercial" : "industrial";
    exampleRow = PACKAGE_EXAMPLE_ROWS_BY_MODE[mode];
  } else {
    // Steps are identical in both modes (Craft/days/hours/Step#/Title/
    // Description/Source record ID) — mode has no effect here.
    exampleRow = STEP_EXAMPLE_ROW;
  }
  const csv = `${columns.map((column) => column.header).join(",")}\n${exampleRow}\n`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="work-${kind}-import-template.csv"`,
    },
  });
}
