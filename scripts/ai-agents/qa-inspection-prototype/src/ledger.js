/**
 * ledger.js — inert ledger-row preview helpers.
 *
 * The preview is advisory only: it is returned inside the report JSON and
 * never updates the real UI-CLICKTHROUGH-LEDGER. Every row is marked
 * synthetic. Column order matches the live ledger format reference:
 * Page/Route, Control, Status, Last verified, Deployed commit tested,
 * Verified by, Notes/fix ref.
 */

export const LEDGER_COLUMNS = Object.freeze([
  "Page/Route",
  "Control",
  "Status",
  "Last verified",
  "Deployed commit tested",
  "Verified by",
  "Notes/fix ref",
]);

/** Render ledger_preview rows as a Markdown table (advisory rendering only). */
export function ledgerToMarkdown(rows) {
  const head = `| ${LEDGER_COLUMNS.join(" | ")} |`;
  const sep = `| ${LEDGER_COLUMNS.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) =>
    `| ${r.page_route} | ${r.control} (${r.kind}) [SYNTHETIC] | ${r.status} | ${r.last_verified ?? "—"} | ${r.deployed_commit_tested} | ${r.verified_by} | ${r.notes} |`.replace(/\n/g, " ")
  );
  return [head, sep, ...body].join("\n");
}
