"use client";

import { useMemo, useRef, useState } from "react";
import {
  contentBounds,
  getChartBackground,
  LAYOUT_NODE_ORG,
  LAYOUT_NODE_WORKFLOW,
} from "@/domains/chartBuilder";
import { gridLineColor } from "./gridPreference.js";

const PAD = 56;

function truncate(text, max = 26) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Elbow connector between two card rectangles.
function edgePath(from, to, nodeW, nodeH, direction) {
  if (direction === "left-right") {
    const x1 = from.x + nodeW;
    const y1 = from.y + nodeH / 2;
    const x2 = to.x;
    const y2 = to.y + nodeH / 2;
    if (x2 >= x1) {
      const midX = (x1 + x2) / 2;
      return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
    }
    // Feedback edge: loop underneath so it never crosses through cards.
    const dipY = Math.max(y1, y2) + 48;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${x1 + 36} ${y1}, ${midX} ${dipY}, ${midX} ${dipY} S ${x2 - 36} ${y2}, ${x2} ${y2}`;
  }
  const x1 = from.x + nodeW / 2;
  const y1 = from.y + nodeH;
  const x2 = to.x + nodeW / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
}

function edgeMidpoint(from, to, nodeW, nodeH, direction) {
  if (direction === "left-right") {
    return { x: (from.x + nodeW + to.x) / 2, y: from.y + nodeH / 2 - 8 };
  }
  return { x: to.x + nodeW / 2, y: (from.y + nodeH + to.y) / 2 - 4 };
}

export default function ChartCanvas({
  doc,
  template,
  nodeSize,
  selectedId,
  gridPreference,
  onSelect,
  onDrop,
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [preview, setPreview] = useState(null);

  const size = nodeSize ?? (doc.type === "org" ? LAYOUT_NODE_ORG : LAYOUT_NODE_WORKFLOW);
  const direction = template?.layoutPreset?.direction ?? (doc.type === "org" ? "top-down" : "left-right");
  const background = getChartBackground(doc.background) ?? getChartBackground("white");

  const nodesById = useMemo(() => {
    const map = new Map();
    for (const node of doc.nodes) map.set(node.id, node);
    return map;
  }, [doc.nodes]);

  const bounds = useMemo(
    () =>
      contentBounds(
        Object.fromEntries(doc.nodes.map((n) => [n.id, n.position])),
        size
      ),
    [doc.nodes, size]
  );
  const canvasW = Math.max(bounds.w + PAD * 2, 640);
  const canvasH = Math.max(bounds.h + PAD * 2, 480);
  const offsetX = PAD - Math.min(0, bounds.x);
  const offsetY = PAD - Math.min(0, bounds.y);

  const gridColor = gridLineColor(gridPreference);
  const gridStyle =
    gridColor == null
      ? undefined
      : {
          backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        };

  function positionOf(node) {
    if (preview && preview.id === node.id) return { x: preview.x, y: preview.y };
    return { x: node.position.x + offsetX, y: node.position.y + offsetY };
  }

  function handlePointerDown(event, node) {
    event.stopPropagation();
    const drag = {
      id: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origX: node.position.x,
      origY: node.position.y,
      moved: false,
    };
    dragRef.current = drag;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      setPreview({ id: drag.id, x: drag.origX + dx, y: drag.origY + dy });
    }
  }

  function handlePointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    setPreview(null);
    if (!drag) return;
    if (!drag.moved) {
      onSelect(drag.id === selectedId ? null : drag.id);
      return;
    }
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    // The dragged node sits under the pointer (pointer capture), so scan the
    // stack and take the first *other* node — that's the drop target.
    const stacked = document.elementsFromPoint(event.clientX, event.clientY) ?? [];
    const targetEl = stacked.find((el) => {
      const holder = el.closest?.("[data-node-id]");
      return holder && holder.dataset.nodeId !== drag.id;
    });
    const target = targetEl?.closest?.("[data-node-id]")?.dataset?.nodeId ?? null;
    onDrop({
      nodeId: drag.id,
      position: { x: drag.origX + dx, y: drag.origY + dy },
      dropTargetId: target && target !== drag.id ? target : null,
    });
  }

  return (
    <div className="overflow-auto rounded-xl border border-slate-300 shadow-inner">
      <div
        className="relative"
        style={{
          width: canvasW,
          height: canvasH,
          background: background.css,
          backgroundSize: background.backgroundSize,
        }}
      >
        {gridStyle && (
          <div className="pointer-events-none absolute inset-0" style={gridStyle} />
        )}
        <svg
          ref={svgRef}
          width={canvasW}
          height={canvasH}
          className="absolute inset-0 touch-none select-none"
          onPointerDown={() => onSelect(null)}
        >
          <defs>
            <marker
              id="chart-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#6b7280" />
            </marker>
          </defs>

          {doc.edges.map((edge) => {
            const from = nodesById.get(edge.from);
            const to = nodesById.get(edge.to);
            if (!from || !to) return null;
            const fromPos = positionOf(from);
            const toPos = positionOf(to);
            const mid = edgeMidpoint(fromPos, toPos, size.w, size.h, direction);
            return (
              <g key={edge.id}>
                <path
                  d={edgePath(fromPos, toPos, size.w, size.h, direction)}
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="2"
                  markerEnd={doc.type === "workflow" ? "url(#chart-arrow)" : undefined}
                />
                {edge.label && (
                  <text
                    x={mid.x}
                    y={mid.y}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#374151"
                    style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3 }}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {doc.nodes.map((node) => {
            const pos = positionOf(node);
            const accent = node.style?.color ?? "#1f6feb";
            const selected = node.id === selectedId;
            const title = node.fields?.title ?? "";
            const dept = node.fields?.department ?? "";
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => handlePointerDown(event, node)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setPreview(null);
                }}
              >
                <rect
                  width={size.w}
                  height={size.h}
                  rx="10"
                  fill="#ffffff"
                  stroke={selected ? "#f59e0b" : accent}
                  strokeWidth={selected ? 3 : 1.5}
                />
                <rect width="6" height={size.h} rx="3" fill={accent} />
                <text x="16" y="26" fontSize="13" fontWeight="700" fill="#111827"
                  textLength={size.w - 28} lengthAdjust="spacingAndGlyphs">
                  {truncate(node.label)}
                </text>
                {node.subtitle && (
                  <text x="16" y="44" fontSize="11" fill="#4b5563"
                    textLength={size.w - 28} lengthAdjust="spacingAndGlyphs">
                    {truncate(node.subtitle, 30)}
                  </text>
                )}
                {(title || dept) && (
                  <text x="16" y={size.h - 12} fontSize="10" fill="#6b7280"
                    textLength={size.w - 28} lengthAdjust="spacingAndGlyphs">
                    {truncate([title, dept].filter(Boolean).join(" · "), 34)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
