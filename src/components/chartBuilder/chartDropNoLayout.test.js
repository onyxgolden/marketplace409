// Regression guard for ChatGPT slice-2 review fix 2:
// auto-layout must never run as a side effect of reparenting on drop.
// handleDrop in ChartBuilderPage.jsx must not call stampLayoutPositions;
// it stays an explicit user action through the auto-layout button.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function extractFunctionBody(source, signature) {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start + signature.length);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${signature}`);
}

describe("chart drop layout guard", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./ChartBuilderPage.jsx", import.meta.url)),
    "utf8"
  );

  it("handleDrop never re-stamps layout positions on drop", () => {
    const body = extractFunctionBody(
      source,
      "function handleDrop({ nodeId, position, dropTargetId })"
    );
    expect(body).not.toContain("stampLayoutPositions");
  });

  it("auto-layout remains an explicit user action", () => {
    const body = extractFunctionBody(source, "function autoLayout()");
    expect(body).toContain("stampLayoutPositions");
  });
});
