import { describe, expect, it } from "vitest";
import { looksLikeFullAddress, parseUsAddress } from "./parseUsAddress";

describe("parseUsAddress", () => {
  it("splits a standard full address", () => {
    expect(parseUsAddress("123 Main St, Springfield, IL 62701")).toEqual({
      street: "123 Main St", unit: "", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("extracts a unit designator from the street segment", () => {
    expect(parseUsAddress("123 Main St, Apt 4, Springfield, IL 62701")).toEqual({
      street: "123 Main St", unit: "Apt 4", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("extracts an inline unit without commas", () => {
    expect(parseUsAddress("123 Main St Suite 200, Springfield, IL 62701")).toEqual({
      street: "123 Main St", unit: "Suite 200", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("handles a hash unit and ZIP+4", () => {
    expect(parseUsAddress("456 Oak Ave #12, Groves, TX 77605-1234")).toEqual({
      street: "456 Oak Ave", unit: "#12", city: "Groves", state: "TX", zip: "77605-1234",
    });
  });

  it("handles directional street suffixes and DC", () => {
    expect(parseUsAddress("1600 Pennsylvania Ave NW, Washington, DC 20500")).toEqual({
      street: "1600 Pennsylvania Ave NW", unit: "", city: "Washington", state: "DC", zip: "20500",
    });
  });

  it("handles a multi-line paste", () => {
    expect(parseUsAddress("123 Main St\nSpringfield, IL 62701")).toEqual({
      street: "123 Main St", unit: "", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("resolves a full state name to its code", () => {
    expect(parseUsAddress("123 Main St, Springfield, Illinois 62701")).toEqual({
      street: "123 Main St", unit: "", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("handles city and state without a comma", () => {
    expect(parseUsAddress("123 Main St, Springfield IL 62701")).toEqual({
      street: "123 Main St", unit: "", city: "Springfield", state: "IL", zip: "62701",
    });
  });

  it("returns null for a street-only paste", () => {
    expect(parseUsAddress("123 Main St")).toBeNull();
  });

  it("returns null for an unparseable blob", () => {
    expect(parseUsAddress("call me maybe")).toBeNull();
    expect(parseUsAddress("")).toBeNull();
    expect(parseUsAddress(null)).toBeNull();
  });
});

describe("looksLikeFullAddress", () => {
  it("flags pasted text that resembles a full address", () => {
    expect(looksLikeFullAddress("123 Main St, Springfield, IL 62701")).toBe(true);
    expect(looksLikeFullAddress("123 Main St\nSpringfield, IL 62701")).toBe(true);
    expect(looksLikeFullAddress("123 Main St")).toBe(false);
    expect(looksLikeFullAddress("")).toBe(false);
  });
});
