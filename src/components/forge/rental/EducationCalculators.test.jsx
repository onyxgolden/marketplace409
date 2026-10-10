// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DscrCalculator, DtiCalculator } from "./EducationCalculators";

// The calculators are a 1:1 port of the researched "Finding the Money" page
// (forge-ai-drop results/muse/rental-education-content-2026-10-10). These
// tests pin the page's own worked defaults and band text so a future edit
// cannot silently change the math: ANRI = rent x 0.75 - PITIA, only a
// negative ANRI adds to debts, DSCR = rent / PITIA, bands at 36/45/50 (DTI)
// and 1.0/1.2 (DSCR), click-to-calculate with the page's prompt text.

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

function unmount({ container, root }) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function setInputValue(input, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(button) {
  act(() => {
    button.click();
  });
}

describe("DtiCalculator (Finding the Money port)", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
  });

  it("shows the page's prompt and defaults before calculating", () => {
    mounted = mount(<DtiCalculator />);
    const text = mounted.container.textContent;
    expect(text).toContain("Enter your numbers and calculate.");
    expect(mounted.container.querySelector("#education-dti-income").value).toBe("10000");
    expect(mounted.container.querySelector("#education-dti-debts").value).toBe("3200");
    expect(mounted.container.querySelector("#education-dti-rent").value).toBe("2000");
    expect(mounted.container.querySelector("#education-dti-pitia").value).toBe("1700");
  });

  it("reproduces the worked example: defaults give 32.0% -> 34.0% with a $200/mo qualifying loss", () => {
    mounted = mount(<DtiCalculator />);
    click(mounted.container.querySelector("button"));
    const text = mounted.container.textContent;
    expect(text).toContain("DTI before: 32.0%");
    expect(text).toContain("after this property: 34.0%");
    expect(text).toContain("within 36% manual range");
    expect(text).toContain("Qualifying rental result is $-200/mo — a loss, so $200/mo is added to your debts.");
    expect(text).toContain("Rent must reach ~1.33× PITIA ($2,267 at this PITIA)");
  });

  it("treats a positive rental result as $0 of new debt, never as new income", () => {
    mounted = mount(<DtiCalculator />);
    setInputValue(mounted.container.querySelector("#education-dti-rent"), "3000");
    setInputValue(mounted.container.querySelector("#education-dti-pitia"), "1500");
    click(mounted.container.querySelector("button"));
    const text = mounted.container.textContent;
    // ANRI = 2250 - 1500 = +750 > 0, so DTI stays at the 32.0% baseline.
    expect(text).toContain("Qualifying rental income is +$750/mo.");
    expect(text).toContain("after this property: 32.0%");
  });

  it("bands a result above the 50% DU maximum as over the cited cap", () => {
    mounted = mount(<DtiCalculator />);
    setInputValue(mounted.container.querySelector("#education-dti-debts"), "6000");
    click(mounted.container.querySelector("button"));
    const text = mounted.container.textContent;
    // (6000 + 200) / 10000 = 62.0%
    expect(text).toContain("after this property: 62.0%");
    expect(text).toContain("above the 50% DU maximum in the cited guide");
  });

  it("guards a zero income instead of dividing by it", () => {
    mounted = mount(<DtiCalculator />);
    setInputValue(mounted.container.querySelector("#education-dti-income"), "0");
    click(mounted.container.querySelector("button"));
    expect(mounted.container.textContent).toContain("Enter a gross monthly income above $0.");
  });
});

describe("DscrCalculator (Finding the Money port)", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
  });

  it("shows the page's prompt and defaults before calculating", () => {
    mounted = mount(<DscrCalculator />);
    expect(mounted.container.textContent).toContain("Enter rent and PITIA and calculate.");
    expect(mounted.container.querySelector("#education-dscr-rent").value).toBe("2900");
    expect(mounted.container.querySelector("#education-dscr-pitia").value).toBe("2710");
  });

  it("reproduces the page's default: $2,900 / $2,710 = 1.07 in the 1.00-1.19 band", () => {
    mounted = mount(<DscrCalculator />);
    click(mounted.container.querySelector("button"));
    const text = mounted.container.textContent;
    expect(text).toContain("DSCR = $2,900 ÷ $2,710 = 1.07");
    expect(text).toContain("1.00–1.19 — within the typical 1.00–1.25 minimum band, pricing usually less favourable");
    expect(text).toContain("DSCR 1.00 is not cash flow");
  });

  it("flags a sub-1.00 result as no-ratio territory and a strong result as best pricing", () => {
    mounted = mount(<DscrCalculator />);
    setInputValue(mounted.container.querySelector("#education-dscr-rent"), "2000");
    click(mounted.container.querySelector("button"));
    expect(mounted.container.textContent).toContain("below 1.00 — “no-ratio” territory (30%+ down, higher rate) if offered at all");
    setInputValue(mounted.container.querySelector("#education-dscr-rent"), "4000");
    click(mounted.container.querySelector("button"));
    // 4000 / 2710 = 1.48
    expect(mounted.container.textContent).toContain("= 1.48");
    expect(mounted.container.textContent).toContain("~1.20–1.25+ — where best pricing typically sits in the cited ranges");
  });

  it("guards a zero PITIA instead of dividing by it", () => {
    mounted = mount(<DscrCalculator />);
    setInputValue(mounted.container.querySelector("#education-dscr-pitia"), "0");
    click(mounted.container.querySelector("button"));
    expect(mounted.container.textContent).toContain("Enter a PITIA above $0.");
  });
});
