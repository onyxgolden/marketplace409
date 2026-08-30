import { describe, expect, it } from "vitest";
import { isMissingRemoteSchemaError } from "./isMissingRemoteSchemaError";

describe("isMissingRemoteSchemaError", () => {
  it("recognizes undefined_table (42P01)", () => {
    expect(isMissingRemoteSchemaError({ code: "42P01", message: 'relation "private_financing_accounts" does not exist' })).toBe(true);
  });

  it("recognizes undefined_function (42883)", () => {
    expect(isMissingRemoteSchemaError({ code: "42883", message: "function append_private_financing_event(...) does not exist" })).toBe(true);
  });

  it("rejects an unrelated Postgres error code", () => {
    expect(isMissingRemoteSchemaError({ code: "23505", message: "duplicate key value" })).toBe(false);
  });

  it("rejects null, undefined, or a non-object error", () => {
    expect(isMissingRemoteSchemaError(null)).toBe(false);
    expect(isMissingRemoteSchemaError(undefined)).toBe(false);
    expect(isMissingRemoteSchemaError("some string error")).toBe(false);
  });

  it("rejects an object with no code field", () => {
    expect(isMissingRemoteSchemaError({ message: "something went wrong" })).toBe(false);
  });

  // Explicit negative proof that this guard cannot be used to (accidentally or otherwise) swallow a
  // failure it was never meant to catch -- each of these must reach the route's ordinary 500 path, never
  // the 503 "schema unavailable" path.
  it("does not swallow an authorization failure (insufficient_privilege, 42501)", () => {
    expect(isMissingRemoteSchemaError({ code: "42501", message: "permission denied for table private_financing_accounts" })).toBe(false);
  });

  it("does not swallow a malformed query (syntax_error, 42601)", () => {
    expect(isMissingRemoteSchemaError({ code: "42601", message: "syntax error at or near ..." })).toBe(false);
  });

  it("does not swallow an undefined-column error (42703) -- a real schema-drift bug, not a missing-migration state", () => {
    expect(isMissingRemoteSchemaError({ code: "42703", message: "column private_financing_accounts.foo does not exist" })).toBe(false);
  });

  it("does not swallow a connectivity failure (connection_failure, 08006)", () => {
    expect(isMissingRemoteSchemaError({ code: "08006", message: "connection to server was lost" })).toBe(false);
  });

  it("does not swallow a too-many-connections failure (53300)", () => {
    expect(isMissingRemoteSchemaError({ code: "53300", message: "too many connections" })).toBe(false);
  });

  it("does not swallow a check-constraint violation (23514)", () => {
    expect(isMissingRemoteSchemaError({ code: "23514", message: "new row violates check constraint" })).toBe(false);
  });

  it("does not swallow a row-level-security policy violation surfaced as an insert failure (42501 via RLS)", () => {
    expect(isMissingRemoteSchemaError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
  });
});
