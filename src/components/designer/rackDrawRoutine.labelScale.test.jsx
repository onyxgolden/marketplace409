// rackDrawRoutine.labelScale.test.jsx — scale-gated rack labels
// (FCCU label-overlap fix). Below the detail threshold (0.25) the
// "Pipe rack · TOS EL …" description hides; below the tag threshold
// (0.09) the rack tag (PR-101 / SL-101) hides too. Zooming in brings
// them back. The two rack labels were the last stragglers in the FCCU
// fit-to-view render: every other label kind was already gated.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawRackSymbol } from "./rackDrawRoutine";

const toScreen = (p) => ({ x: p.x, y: p.y });
const pipeRack = {
  id: "pipe-rack",
  label: "Pipe rack",
  widthIn: 480,
  depthIn: 240,
  rack: { kind: "pipe", tiers: 2, elevationIn: 180, tierSpacingIn: 72, bentSpacingIn: 240 },
};
const renderRack = (scale) =>
  renderToStaticMarkup(
    <svg>
      {drawRackSymbol({
        symbol: pipeRack,
        instance: { id: "r1", x: 0, y: 0, tag: "PR-101" },
        toScreen,
        scale,
        highlighted: false,
      })}
    </svg>,
  );

describe("drawRackSymbol label gating", () => {
  it("hides the tag and the description below the tag threshold", () => {
    const html = renderRack(0.0445); // phone fit
    expect(html).not.toContain("PR-101");
    expect(html).not.toContain("Pipe rack · TOS EL");
  });

  it("shows the tag but not the description between the thresholds", () => {
    const html = renderRack(0.139); // desktop fit
    expect(html).toContain("PR-101");
    expect(html).not.toContain("Pipe rack · TOS EL");
  });

  it("shows both at normal working zoom", () => {
    const html = renderRack(1.6);
    expect(html).toContain("PR-101");
    expect(html).toContain("Pipe rack · TOS EL");
  });
});
