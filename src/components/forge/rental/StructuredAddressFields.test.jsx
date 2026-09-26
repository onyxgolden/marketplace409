// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import StructuredAddressFields from "./StructuredAddressFields";

function renderFields(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<StructuredAddressFields {...props} />));
  return { container, root };
}

describe("StructuredAddressFields", () => {
  let rendered;
  afterEach(() => { if (rendered) act(() => rendered.root.unmount()); rendered?.container.remove(); rendered = null; });

  it("renders the structured fields with a US state dropdown", () => {
    rendered = renderFields();
    const { container } = rendered;
    expect(container.querySelector('input[name="addressStreet"]')).not.toBeNull();
    expect(container.querySelector('input[name="addressUnit"]')).not.toBeNull();
    expect(container.querySelector('input[name="addressCity"]')).not.toBeNull();
    expect(container.querySelector('select[name="addressState"]')).not.toBeNull();
    expect(container.querySelector('input[name="addressZip"]')).not.toBeNull();
    const options = [...container.querySelectorAll('select[name="addressState"] option')].map((o) => o.value);
    expect(options).toContain("TX");
    expect(options).toContain("DC");
    expect(options).toHaveLength(52); // placeholder + 50 states + DC
    expect(container.textContent).toContain("paste a full address");
  });

  it("prefills initial values (edit mode)", () => {
    rendered = renderFields({ initialValues: { street: "123 Main St", unit: "Apt 4", city: "Springfield", state: "IL", zip: "62701" } });
    const { container } = rendered;
    expect(container.querySelector('input[name="addressStreet"]').value).toBe("123 Main St");
    expect(container.querySelector('input[name="addressCity"]').value).toBe("Springfield");
    expect(container.querySelector('select[name="addressState"]').value).toBe("IL");
    expect(container.querySelector('input[name="addressZip"]').value).toBe("62701");
  });

  it("splits a pasted full address into the fields", async () => {
    rendered = renderFields();
    const { container } = rendered;
    const street = container.querySelector('input[name="addressStreet"]');
    const paste = new Event("paste", { bubbles: true });
    paste.clipboardData = { getData: () => "123 Main St, Apt 4, Springfield, IL 62701" };
    let prevented = false;
    paste.preventDefault = () => { prevented = true; };
    await act(async () => { street.dispatchEvent(paste); });
    expect(prevented).toBe(true);
    expect(street.value).toBe("123 Main St");
    expect(container.querySelector('input[name="addressUnit"]').value).toBe("Apt 4");
    expect(container.querySelector('input[name="addressCity"]').value).toBe("Springfield");
    expect(container.querySelector('select[name="addressState"]').value).toBe("IL");
    expect(container.querySelector('input[name="addressZip"]').value).toBe("62701");
  });

  it("ignores a paste that is not a full address", async () => {
    rendered = renderFields();
    const { container } = rendered;
    const street = container.querySelector('input[name="addressStreet"]');
    const paste = new Event("paste", { bubbles: true });
    paste.clipboardData = { getData: () => "123 Main St" };
    let prevented = false;
    paste.preventDefault = () => { prevented = true; };
    await act(async () => { street.dispatchEvent(paste); });
    expect(prevented).toBe(false);
    expect(container.querySelector('input[name="addressCity"]').value).toBe("");
  });

  it("shows an inline error for an invalid ZIP on blur", async () => {
    rendered = renderFields();
    const { container } = rendered;
    const zip = container.querySelector('input[name="addressZip"]');
    await act(async () => {
      zip.value = "12";
      zip.dispatchEvent(new Event("change", { bubbles: true }));
      // React implements onBlur through the bubbling focusout event.
      zip.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(container.textContent).toMatch(/valid ZIP/i);
  });

  it("surfaces submit-time errors passed from the parent", () => {
    rendered = renderFields({ externalErrors: { zip: "Enter a valid ZIP code (12345 or 12345-6789)." } });
    expect(rendered.container.textContent).toContain("Enter a valid ZIP code");
  });

  it("stops showing a submit-time error for a field the user edits", async () => {
    rendered = renderFields({ externalErrors: { zip: "Enter a valid ZIP code (12345 or 12345-6789)." } });
    const { container } = rendered;
    expect(container.textContent).toContain("Enter a valid ZIP code");
    const zip = container.querySelector('input[name="addressZip"]');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      nativeSetter.call(zip, "62701");
      zip.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Enter a valid ZIP code");
  });
});
