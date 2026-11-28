import { describe, expect, it } from "vitest";
import { isMissingTableError } from "./isMissingTableError";

describe("isMissingTableError", () => {
  it("recognizes undefined_table by code (42P01)", () => {
    expect(isMissingTableError({ code: "42P01", message: 'relation "forge_work_field_verifications" does not exist' })).toBe(true);
  });

  it("recognizes the PostgREST schema-cache code (PGRST205)", () => {
    expect(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.forge_work_field_verifications' in the schema cache" })).toBe(true);
  });

  it("recognizes the message shape alone, without a code", () => {
    expect(isMissingTableError({ message: "Could not find the table 'public.forge_work_field_verifications' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ message: 'relation "forge_work_field_verifications" does not exist' })).toBe(true);
  });

  it("recognizes the relation-does-not-exist message without the code", () => {
    expect(isMissingTableError({ code: "XX000", message: 'relation "x" does not exist' })).toBe(true);
  });

  // Explicit negative proof that this guard cannot be used to
  // (accidentally or otherwise) swallow a failure it was never meant
  // to catch — each of these must reach the route's ordinary 500
  // path, never the 503 "not available yet" path.
  it("does not swallow an authorization failure (insufficient_privilege, 42501)", () => {
    expect(isMissingTableError({ code: "42501", message: "permission denied for table forge_work_field_verifications" })).toBe(false);
  });

  it("does not swallow an undefined-column error (42703) — a real schema-drift bug, not a missing migration", () => {
    expect(isMissingTableError({ code: "42703", message: 'column "foo" does not exist' })).toBe(false);
  });

  it("does not swallow a missing function (PGRST202) — the RPC guard owns that shape", () => {
    expect(isMissingTableError({ code: "PGRST202", message: "Could not find the function" })).toBe(false);
  });

  it("does not swallow a connectivity failure (connection_failure, 08006)", () => {
    expect(isMissingTableError({ code: "08006", message: "connection to server was lost" })).toBe(false);
  });

  it("does not swallow a unique-violation (23505)", () => {
    expect(isMissingTableError({ code: "23505", message: "duplicate key value" })).toBe(false);
  });

  it("rejects null, undefined, or a non-object error", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError("Could not find the table")).toBe(false);
  });
});
