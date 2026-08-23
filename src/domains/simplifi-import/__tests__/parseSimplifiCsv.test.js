import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSimplifiCsv } from "../parseSimplifiCsv";

const fixture = readFileSync(
  resolve(fileURLToPath(new URL(".", import.meta.url)), "fixtures/basic.csv"),
  "utf8",
);

describe("parseSimplifiCsv", () => {
  it("parses quoted cells, signed cents, tags, pending state, and calendar dates", () => {
    const result = parseSimplifiCsv(fixture);
    expect(result).toMatchObject({ row_count: 3, byte_length: Buffer.byteLength(fixture) });
    expect(result.batch_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rows[0]).toMatchObject({
      account_name: "Business Checking",
      date: "2026-08-01",
      amount_cents: 150000,
      status: "cleared",
    });
    expect(result.rows[1]).toMatchObject({
      amount_cents: -12543,
      tags: ["Rental", "Property A"],
      notes: "Meter, main house",
    });
    expect(result.rows[2].status).toBe("pending");
  });

  it("reports unknown columns without persisting them on rows", () => {
    const result = parseSimplifiCsv("Account,Date,Payee,Amount,Mystery\nChecking,8/1/2026,A,1.00,x");
    expect(result.unknown_headers).toEqual(["Mystery"]);
    expect(result.rows[0]).not.toHaveProperty("mystery");
  });

  it.each([
    ["", "required"],
    ["Account,Date,Payee,Amount\nChecking,2/30/2026,A,1.00", "invalid date"],
    ["Account,Date,Payee,Amount\nChecking,8/1/2026,A,one", "invalid amount"],
    ["Account,Date,Payee\nChecking,8/1/2026,A", "missing required headers"],
    ['Account,Date,Payee,Amount\nChecking,8/1/2026,"A,1.00', "unterminated"],
  ])("fails closed for malformed input", (csv, message) => {
    expect(() => parseSimplifiCsv(csv)).toThrow(message);
  });

  it("rejects explicit byte and row cap overflow rather than truncating", () => {
    expect(() => parseSimplifiCsv(fixture, { maximumBytes: 10 })).toThrow("10 bytes or smaller");
    expect(() => parseSimplifiCsv(fixture, { maximumRows: 2 })).toThrow("2 rows or fewer");
  });
});
