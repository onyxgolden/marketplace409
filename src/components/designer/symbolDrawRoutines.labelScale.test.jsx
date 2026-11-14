// symbolDrawRoutines.labelScale.test.jsx — scale-gated plan labels
// (FCCU label-overlap fix). Below the detail threshold (0.25) the long
// description lines hide; below the tag threshold (0.09) the short tags
// hide too. Zooming in brings them back. Thresholds live in
// designerGeometry (PLAN_DETAIL_LABEL_MIN_SCALE / PLAN_TAG_LABEL_MIN_SCALE)
// and are sized from the FCCU sample's measured fit scales (desktop
// 1400x800: 0.139; phone 390x700: 0.0445).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  drawDefaultSymbol,
  drawOrgChart,
  drawProcessEquipmentSymbol,
  drawRoomSymbol,
} from "./symbolDrawRoutines";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import "@/domains/roomDesigner/processEquipmentCatalog";

const toScreen = (p) => ({ x: p.x, y: p.y });

const pump = findSymbol("processEquipment", "centrifugal-pump");
const pumpInstance = { id: "p1", x: 0, y: 0, tag: "P-101" };
const renderPump = (scale) =>
  renderToStaticMarkup(
    <svg>
      {drawProcessEquipmentSymbol({
        symbol: pump,
        instance: pumpInstance,
        toScreen,
        scale,
        highlighted: false,
      })}
    </svg>,
  );

const room = {
  id: "room_1",
  label: "Kitchen",
  polygon: [
    { x: 0, y: 0 },
    { x: 144, y: 0 },
    { x: 144, y: 144 },
    { x: 0, y: 144 },
  ],
};
const renderRoom = (scale) =>
  renderToStaticMarkup(
    <svg>{drawRoomSymbol({ instance: room, toScreen, scale, highlighted: false })}</svg>,
  );

const defaultSymbol = { id: "custom-1", label: "Custom valve", widthIn: 24, depthIn: 12 };
const renderDefault = (scale) =>
  renderToStaticMarkup(
    <svg>
      {drawDefaultSymbol({
        symbol: defaultSymbol,
        instance: { id: "s1", x: 0, y: 0 },
        toScreen,
        scale,
        highlighted: false,
      })}
    </svg>,
  );

const chart = {
  id: "org_1",
  name: "Turnaround team",
  x: 0,
  y: 0,
  nodes: [{ id: "n1", name: "Dana Lead", title: "Planner", department: "Planning" }],
};
const renderChart = (scale) =>
  renderToStaticMarkup(
    <svg>{drawOrgChart({ chart, toScreen, scale, highlighted: false })}</svg>,
  );

describe("drawProcessEquipmentSymbol label gating", () => {
  it("hides the tag and the description below the tag threshold", () => {
    const html = renderPump(0.0445); // phone fit
    expect(html).not.toContain("P-101");
    expect(html).not.toContain("Centrifugal pump");
  });

  it("shows the tag but not the description between the thresholds", () => {
    const html = renderPump(0.139); // desktop fit
    expect(html).toContain("P-101");
    expect(html).not.toContain("Centrifugal pump");
  });

  it("shows both at normal working zoom", () => {
    const html = renderPump(1.6);
    expect(html).toContain("P-101");
    expect(html).toContain("Centrifugal pump");
  });
});

describe("drawRoomSymbol label gating", () => {
  it("hides the room name and area below the tag threshold", () => {
    const html = renderRoom(0.0445);
    expect(html).not.toContain("Kitchen");
    expect(html).not.toContain("144 sq ft");
  });

  it("shows the room name but not the area between the thresholds", () => {
    const html = renderRoom(0.139);
    expect(html).toContain("Kitchen");
    expect(html).not.toContain("144 sq ft");
  });

  it("shows both at normal working zoom", () => {
    const html = renderRoom(1.6);
    expect(html).toContain("Kitchen");
    expect(html).toContain("144 sq ft");
  });
});

describe("drawDefaultSymbol label gating", () => {
  it("hides the label below the tag threshold and shows it above", () => {
    expect(renderDefault(0.0445)).not.toContain("Custom valve");
    expect(renderDefault(0.139)).toContain("Custom valve");
    expect(renderDefault(1.6)).toContain("Custom valve");
  });
});

describe("drawOrgChart label gating", () => {
  it("hides the chart name and node text below the detail threshold", () => {
    const html = renderChart(0.139);
    expect(html).not.toContain("Turnaround team");
    expect(html).not.toContain("Dana Lead");
    expect(html).not.toContain("Planner");
  });

  it("shows the chart name and node text at normal working zoom", () => {
    const html = renderChart(1.6);
    expect(html).toContain("Turnaround team");
    expect(html).toContain("Dana Lead");
    expect(html).toContain("Planner");
  });
});
