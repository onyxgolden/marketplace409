// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalRecordBrowser from "./RentalRecordBrowser";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function flush(times = 6) { for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
function click(el) { return act(async () => { el.click(); await Promise.resolve(); await Promise.resolve(); }); }
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
}

let root;
afterEach(() => { if (root) act(() => root.unmount()); root = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function mount(node) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
  return container;
}

const records = [
  { id: "one", name: "Main residence", tenant: "Ashley George" },
  { id: "two", name: "Second unit", tenant: null },
];
const columns = [
  { header: "Property", filterText: (item) => item.name, render: (item) => item.name },
  { header: "Tenant", filterText: (item) => item.tenant || "Vacant", render: (item) => item.tenant || "Vacant" },
];
function browser() {
  return mount(<RentalRecordBrowser title="Rental units" records={records} selectedId="one" onSelect={() => {}} columns={columns}><p>Detail</p></RentalRecordBrowser>);
}

describe("RentalRecordBrowser column filters", () => {
  it("filters rows by the column title's filter input", async () => {
    const container = browser();
    await flush();
    expect(container.textContent).toContain("Main residence");
    expect(container.textContent).toContain("Second unit");
    await click(container.querySelector("button[aria-label='Filter Tenant']"));
    const input = container.querySelector("input[aria-label='Filter Tenant']");
    expect(input).not.toBeNull();
    type(input, "ashley");
    await flush();
    expect(container.textContent).toContain("Main residence");
    expect(container.textContent).not.toContain("Second unit");
    expect(container.textContent).toContain("1 of 2 records");
  });
  it("clears back to all rows and shows the empty state when nothing matches", async () => {
    const container = browser();
    await flush();
    await click(container.querySelector("button[aria-label='Filter Property']"));
    type(container.querySelector("input[aria-label='Filter Property']"), "zzz-no-match");
    await flush();
    expect(container.textContent).toContain("No records match these column filters.");
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Clear column filters"));
    await flush();
    expect(container.textContent).toContain("Main residence");
    expect(container.textContent).toContain("Second unit");
  });
  it("leaves titles without filter text unclickable", async () => {
    const container = mount(<RentalRecordBrowser title="Rental units" records={records} selectedId="one" onSelect={() => {}}
      columns={[{ header: "Property", render: (item) => item.name }]}><p>Detail</p></RentalRecordBrowser>);
    await flush();
    expect(container.querySelector("[aria-label='Filter Property']")).toBeNull();
    expect(container.textContent).toContain("Property");
  });
});

describe("RentalRecordBrowser column sorts", () => {
  const sortRecords = [
    { id: "z", name: "Zebra", balance: 5000 },
    { id: "a", name: "apple", balance: null },
    { id: "m", name: "Mango", balance: 120000 },
  ];
  const sortColumns = [
    { header: "Property", filterText: (item) => item.name, render: (item) => item.name },
    { header: "Balance", filterText: (item) => (item.balance === null ? "" : `$${(item.balance / 100).toFixed(2)}`), sortValue: (item) => item.balance, render: (item) => (item.balance === null ? "—" : `$${(item.balance / 100).toFixed(2)}`) },
  ];
  function sortBrowser() {
    return mount(<RentalRecordBrowser title="Rental units" records={sortRecords} selectedId="z" onSelect={() => {}} columns={sortColumns}><p>Detail</p></RentalRecordBrowser>);
  }
  function rowOrder(container) {
    return [...container.querySelectorAll("tbody tr")].map((row) => row.textContent);
  }

  it("cycles text sort ascending, descending, then back to original order", async () => {
    const container = sortBrowser();
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Zebra", "apple", "Mango"]);
    await click(container.querySelector("button[aria-label='Sort Property']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["apple", "Mango", "Zebra"]);
    await click(container.querySelector("button[aria-label='Sort Property asc (active)']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Zebra", "Mango", "apple"]);
    await click(container.querySelector("button[aria-label='Sort Property desc (active)']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Zebra", "apple", "Mango"]);
  });
  it("sorts money by value with blanks last in both directions", async () => {
    const container = sortBrowser();
    await flush();
    await click(container.querySelector("button[aria-label='Sort Balance']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Zebra", "Mango", "apple"]);
    await click(container.querySelector("button[aria-label='Sort Balance asc (active)']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Mango", "Zebra", "apple"]);
  });
  it("sorts the filtered rows, not the full list", async () => {
    const container = sortBrowser();
    await flush();
    await click(container.querySelector("button[aria-label='Filter Property']"));
    type(container.querySelector("input[aria-label='Filter Property']"), "e");
    await flush();
    expect(container.textContent).toContain("2 of 3 records");
    await click(container.querySelector("button[aria-label='Sort Balance']"));
    await flush();
    expect(rowOrder(container).map((text) => text.slice(0, 5))).toEqual(["Zebra", "apple"]);
  });
  it("leaves titles without filter text without a sort control", async () => {
    const container = mount(<RentalRecordBrowser title="Rental units" records={sortRecords} selectedId="z" onSelect={() => {}}
      columns={[{ header: "Property", render: (item) => item.name }]}><p>Detail</p></RentalRecordBrowser>);
    await flush();
    expect(container.querySelector("[aria-label='Sort Property']")).toBeNull();
  });
});
