// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import EditableGridCell from "./EditableGridCell.jsx";

async function renderCell(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<EditableGridCell value="Alpha" display="Alpha" ariaLabel="Title" onCommit={async () => {}} {...props} />);
  });
  return { container, root };
}

function cell(container) {
  return container.querySelector('[role="gridcell"]');
}

async function doubleClick(container) {
  await act(async () => {
    cell(container).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
}

async function typeInto(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("EditableGridCell", () => {
  it("shows the display value and does not edit on a single click", async () => {
    const { container } = await renderCell();
    expect(cell(container).textContent).toBe("Alpha");
    await act(async () => {
      cell(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("input")).toBe(null);
  });

  it("double-click opens a text editor; Enter commits the new value", async () => {
    const onCommit = vi.fn(async () => {});
    const { container } = await renderCell({ onCommit });
    await doubleClick(container);
    const input = container.querySelector("input");
    expect(input).not.toBe(null);
    expect(input.value).toBe("Alpha");
    await typeInto(input, "Beta");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("Beta");
    expect(container.querySelector("input")).toBe(null);
  });

  it("blur commits, and Esc cancels without committing", async () => {
    const onCommit = vi.fn(async () => {});
    const { container } = await renderCell({ onCommit });
    await doubleClick(container);
    const input = container.querySelector("input");
    await typeInto(input, "Gamma");
    await act(async () => {
      input.blur();
    });
    expect(onCommit).toHaveBeenCalledWith("Gamma");

    await doubleClick(container);
    const input2 = container.querySelector("input");
    await typeInto(input2, "Delta");
    await act(async () => {
      input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(container.querySelector("input")).toBe(null);
  });

  it("an unchanged value never commits", async () => {
    const onCommit = vi.fn(async () => {});
    const { container } = await renderCell({ onCommit });
    await doubleClick(container);
    const input = container.querySelector("input");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a failed commit reverts the cell and reports the message", async () => {
    const onCommit = vi.fn(async () => { throw new Error("Title is required."); });
    const onError = vi.fn();
    const { container } = await renderCell({ onCommit, onError });
    await doubleClick(container);
    const input = container.querySelector("input");
    await typeInto(input, "");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onError).toHaveBeenCalledWith("Title is required.");
    // The cell is back in display mode showing the old value, not the
    // failed draft — the value prop is the source of truth.
    expect(container.querySelector("input")).toBe(null);
    expect(cell(container).textContent).toBe("Alpha");
  });

  it("a select editor commits on change with the chosen value", async () => {
    const onCommit = vi.fn(async () => {});
    const { container } = await renderCell({
      value: "draft", display: "draft", editor: "select",
      options: [
        { value: "draft", label: "draft" },
        { value: "planned", label: "planned" },
      ],
      onCommit,
    });
    await doubleClick(container);
    const select = container.querySelector("select");
    expect(select).not.toBe(null);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(select, "planned");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("planned");
  });

  it("a read-only cell never enters edit mode", async () => {
    const onCommit = vi.fn(async () => {});
    const { container } = await renderCell({ readOnly: true, onCommit });
    await doubleClick(container);
    expect(container.querySelector("input")).toBe(null);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a client-side validation failure reports and never calls the server", async () => {
    const onCommit = vi.fn(async () => {});
    const onError = vi.fn();
    const { container } = await renderCell({
      onCommit, onError,
      validate: (next) => (next.trim() === "" ? "Title is required." : null),
    });
    await doubleClick(container);
    const input = container.querySelector("input");
    await typeInto(input, "   ");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Title is required.");
  });
});
