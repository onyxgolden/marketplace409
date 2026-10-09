// Tests for forge-capture-app/ui/symbol-registry.js -- the shared
// adapter dispatching between PT-4's workflow-symbols.js and PT-5's
// pid-symbols.js. No DOM.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKFLOW_SYMBOLS,
  PID_SYMBOLS,
  SymbolRegistryError,
  isPidSymbolType,
  symbolDefinition,
  findSymbolDefinition,
  validateSymbolPlacement,
  symbolToDrawOps,
} from "../symbol-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("isPidSymbolType", () => {
  it("is true only for a pid.-prefixed string", () => {
    expect(isPidSymbolType("pid.rotating.centrifugal_pump")).toBe(true);
    expect(isPidSymbolType("process")).toBe(false);
    expect(isPidSymbolType("")).toBe(false);
    expect(isPidSymbolType(undefined)).toBe(false);
    expect(isPidSymbolType(null)).toBe(false);
    expect(isPidSymbolType(42)).toBe(false);
  });
});

describe("symbolDefinition — dispatch", () => {
  it("resolves a PT-4 workflow id to the workflow registry", () => {
    expect(symbolDefinition("process").name).toBe("Process");
  });

  it("resolves a PT-5 pid id to the pid registry", () => {
    expect(symbolDefinition("pid.rotating.centrifugal_pump").name).toBe("Centrifugal pump");
  });

  it("fails closed on an unknown id from either namespace, as SymbolRegistryError (never the registry's own error class)", () => {
    expect(() => symbolDefinition("not_a_symbol")).toThrow(SymbolRegistryError);
    expect(() => symbolDefinition("pid.not.a_symbol")).toThrow(SymbolRegistryError);
  });
});

describe("findSymbolDefinition — non-throwing lookup", () => {
  it("returns the definition for a known id in either namespace", () => {
    expect(findSymbolDefinition("process")?.name).toBe("Process");
    expect(findSymbolDefinition("pid.flare.flare_stack")?.name).toBe("Flare stack");
  });

  it("returns undefined (never throws) for an unknown id", () => {
    expect(findSymbolDefinition("not_a_symbol")).toBeUndefined();
    expect(findSymbolDefinition("pid.not.a_symbol")).toBeUndefined();
    expect(findSymbolDefinition(undefined)).toBeUndefined();
  });
});

describe("validateSymbolPlacement — dispatch", () => {
  it("validates a workflow symbol through the workflow registry's own rules", () => {
    const result = validateSymbolPlacement("process", { w: 100, h: 50, label: "Step" });
    expect(result).toEqual({ symbolType: "process", w: 100, h: 50, label: "Step" });
  });

  it("validates a pid symbol through the pid registry's own rules", () => {
    const result = validateSymbolPlacement("pid.rotating.generic_driver", { w: 70, h: 70, label: "Pump 1" });
    expect(result).toEqual({ symbolType: "pid.rotating.generic_driver", w: 70, h: 70, label: "Pump 1" });
  });

  it("fails closed below a pid symbol's own minimum size, as SymbolRegistryError", () => {
    expect(() =>
      validateSymbolPlacement("pid.rotating.generic_driver", { w: 1, h: 1 })
    ).toThrow(SymbolRegistryError);
  });

  it("fails closed below a workflow symbol's own minimum size, as SymbolRegistryError", () => {
    expect(() => validateSymbolPlacement("process", { w: 1, h: 1 })).toThrow(SymbolRegistryError);
  });
});

describe("symbolToDrawOps — dispatch", () => {
  it("renders a workflow symbol's ops via the workflow registry", () => {
    const shape = { id: "m1-1", x: 10, y: 10, ...validateSymbolPlacement("process", { w: 100, h: 50 }) };
    expect(symbolToDrawOps(shape).length).toBeGreaterThan(0);
  });

  it("renders a pid symbol's ops via the pid registry", () => {
    const shape = {
      id: "m1-1",
      x: 10,
      y: 10,
      ...validateSymbolPlacement("pid.rotating.generic_driver", { w: 70, h: 70 }),
    };
    expect(symbolToDrawOps(shape).length).toBeGreaterThan(0);
  });
});

describe("re-exports", () => {
  it("re-exports both full registries unmodified", () => {
    expect(WORKFLOW_SYMBOLS).toHaveLength(17);
    expect(PID_SYMBOLS).toHaveLength(35);
  });
});

describe("structural guarantee — no capture, no IPC, no persistence, no network, no DOM/HTML work", () => {
  it("symbol-registry.js never references invoke(), the real session commands, storage, filesystem, network, or innerHTML", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "symbol-registry.js"), "utf8");
    expect(source).not.toMatch(/invoke\s*\(/);
    expect(source).not.toContain("process_capture_start_session");
    expect(source).not.toContain("process_capture_stop_session");
    expect(source).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\s*[.(]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/writeFile|readFile|require\(["']fs["']\)|from ["']fs["']/);
    expect(source).not.toMatch(/\.innerHTML\s*[=.]/);
  });
});
