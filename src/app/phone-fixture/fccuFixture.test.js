// Proves the FCCU provenance chain end to end in this checkout:
// the pure-JS SHA-256 + canonical JSON reproduce the manifest hash
// for the committed snapshot bytes and the generator output, and
// verification fails hard on tampering.
//
// Note: the browser fixture loads the snapshot via fetch (exact bytes
// from public/) because the Turbopack dev bundler re-serializes JSON
// imports and silently alters 130 float values. These Node-side tests
// read the same committed bytes from disk, so the hash assertions
// below bind the exact bytes the browser fetches.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROVENANCE,
  canonicalJson,
  countFccuDesign,
  sha256Hex,
  verifyFccuDesign,
} from "./fccuFixture";
import { buildFccuPlotPlan } from "@/domains/roomDesigner/fccuPlotPlanSample";

const SNAPSHOT_PATH = new URL(
  "../../../public/phone-fixture/fccu-design-snapshot.json",
  import.meta.url,
);

function readSnapshot() {
  const raw = readFileSync(SNAPSHOT_PATH, "utf8");
  return { raw, design: JSON.parse(raw) };
}

describe("fccuFixture provenance", () => {
  it("sha256 matches the FIPS vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("canonical JSON is sorted, compact, raw non-ASCII", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ t: "Réactor — test" })).toBe('{"t":"Réactor — test"}');
  });

  it("committed snapshot bytes verify against the manifest hash and counts", () => {
    const { raw, design } = readSnapshot();
    // The file is written in canonical form, so the raw bytes hash
    // directly to the manifest hash — the same bytes the browser fetches.
    expect(sha256Hex(raw)).toBe(PROVENANCE.levelDesignSha256);
    expect(sha256Hex(raw)).toBe("94b37f104a5cc02cfb2e69549d5703de29844274a12cb7019cfba7fce190d9cd");
    const { sha, counts } = verifyFccuDesign(design);
    expect(sha).toBe(PROVENANCE.levelDesignSha256);
    expect(counts.pipes).toBe(91);
    expect(counts.symbols).toBe(91);
    expect(counts.equipment).toBe(21);
    expect(counts.annotations).toBe(5);
    expect(counts.rooms).toBe(4);
    expect(counts.systems).toBe(14);
  });

  it("committed snapshot is byte-identical to the generator output", () => {
    const { design } = readSnapshot();
    const project = buildFccuPlotPlan();
    const generated = project.levels[0].design;
    expect(sha256Hex(canonicalJson(generated))).toBe(sha256Hex(canonicalJson(design)));
    expect(sha256Hex(canonicalJson(generated))).toBe(PROVENANCE.levelDesignSha256);
  }, 60000);

  it("a mutated design fails verification (no silent fallback)", () => {
    const { design } = readSnapshot();
    const mutated = JSON.parse(JSON.stringify(design));
    mutated.pipes = mutated.pipes.slice(0, 90);
    expect(() => verifyFccuDesign(mutated)).toThrow(/count pipes mismatch|SHA mismatch/);
    expect(countFccuDesign(mutated).pipes).toBe(90);
  });

  it("a mutated hash expectation fails even with matching counts", () => {
    const { design } = readSnapshot();
    const mutated = JSON.parse(JSON.stringify(design));
    mutated.annotations[0].text = "tampered";
    expect(() => verifyFccuDesign(mutated)).toThrow(/SHA mismatch/);
  });
});
