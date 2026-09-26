// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Header", () => ({
  default: function HeaderStub() {
    return <div data-header-stub />;
  },
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// The institution domain's repository chain eagerly builds a Supabase browser
// client at import time, which throws without env -- the picker only needs
// the static defaults, so stub the service boundary.
vi.mock("@/domains/institution", () => ({
  InstitutionService: {
    getDefaults: () => [
      { name: "Chase", type: "bank", supports_sync: true },
      { name: "Manual", type: "manual", supports_sync: false },
    ],
  },
}));

import AddAccountPage from "./page";

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AddAccountPage />);
  });
  return { container, root };
}

function unmount(mounted) {
  act(() => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}

function click(element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function findContinueButtons(container) {
  return Array.from(container.querySelectorAll("button")).filter((button) =>
    button.textContent.includes("Continue")
  );
}

describe("AddAccountPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("keeps the Continue button disabled until an institution is selected", () => {
    const mounted = mount();
    try {
      // Before selection only the bottom Continue exists; the selected-card
      // Continue appears once an institution is chosen.
      const continues = findContinueButtons(mounted.container);
      expect(continues.length).toBe(1);
      expect(continues[0].disabled).toBe(true);
      expect(continues[0].textContent).toBe("Continue");
      expect(mounted.container.textContent).not.toContain("Account Details");
    } finally {
      unmount(mounted);
    }
  });

  it("advances to the account-details step when Continue is clicked", () => {
    const mounted = mount();
    try {
      const chaseCard = mounted.container.querySelector(
        '[aria-label="Select Chase"]'
      );
      click(chaseCard);

      const continues = findContinueButtons(mounted.container);
      expect(continues.length).toBe(2);
      continues.forEach((button) => {
        expect(button.disabled).toBe(false);
      });

      click(continues[0]);
      expect(mounted.container.textContent).toContain("Account Details");
      expect(mounted.container.textContent).toContain("Chase");
    } finally {
      unmount(mounted);
    }
  });

  it("selects an institution with the keyboard", () => {
    const mounted = mount();
    try {
      const chaseCard = mounted.container.querySelector(
        '[aria-label="Select Chase"]'
      );
      act(() => {
        chaseCard.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      });
      const continues = findContinueButtons(mounted.container);
      continues.forEach((button) => {
        expect(button.disabled).toBe(false);
      });
    } finally {
      unmount(mounted);
    }
  });

  it("shows the manual account form for the Manual institution and saves via the existing endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, accountId: "financial_account_manual_new" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const mounted = mount();
    try {
      click(mounted.container.querySelector('[aria-label="Select Manual"]'));
      click(findContinueButtons(mounted.container)[0]);

      expect(mounted.container.textContent).toContain("Account Details");

      const nameInput = mounted.container.querySelector('input[name="account-name"]');
      const balanceInput = mounted.container.querySelector('input[name="account-balance"]');
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      await act(async () => {
        setValue.call(nameInput, "Emergency fund");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        setValue.call(balanceInput, "10000");
        balanceInput.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const form = mounted.container.querySelector("form");
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/financial/accounts");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.name).toBe("Emergency fund");
      expect(body.currentBalanceCents).toBe(1000000);
      expect(mounted.container.textContent).toContain("Account added");
    } finally {
      unmount(mounted);
    }
  });

  it("tells the user a sync institution has no connection flow yet instead of dead-ending", () => {
    const mounted = mount();
    try {
      click(mounted.container.querySelector('[aria-label="Select Chase"]'));
      click(findContinueButtons(mounted.container)[0]);

      expect(mounted.container.textContent).toContain("Account Details");
      expect(mounted.container.textContent).toContain(
        "isn't available in this flow yet"
      );

      // And they can get back to the picker.
      const backButton = Array.from(
        mounted.container.querySelectorAll("button")
      ).find((button) =>
        button.textContent.includes("Choose a different institution")
      );
      click(backButton);
      expect(mounted.container.textContent).toContain(
        "Choose where this account is held."
      );
    } finally {
      unmount(mounted);
    }
  });
});
