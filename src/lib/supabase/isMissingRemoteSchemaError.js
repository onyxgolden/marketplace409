// Detects "this table/RPC does not exist on this database yet" -- the Postgres error codes for
// undefined_table (42P01) and undefined_function (42883). No prior route in this repo has needed this
// guard (every other migration has always been applied to the linked remote project before its first
// caller shipped); Private Financing is the first feature where the domain/API layer can land on a
// branch before its own migration has been applied remotely (SF-1's migration is written and locally
// validated but deliberately not yet applied to Production). A route hitting a private_financing_* table
// or RPC must treat this specific failure as a controlled "not available yet" response, never a 500 and
// never an unhandled crash of the surrounding Rental Manager shell.
export function isMissingRemoteSchemaError(error) {
  if (!error || typeof error !== "object") return false;
  return error.code === "42P01" || error.code === "42883";
}
