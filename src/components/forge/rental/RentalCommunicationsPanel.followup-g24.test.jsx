// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalCommunicationsPanel from "./RentalCommunicationsPanel";
import { clearSWRCache } from "@/hooks/swrCache";

// Controls-sweep follow-up G24 (O-16): retry failed, resend sent.
const FAILED = { id: "notif_f", subject: "Rent reminder", status: "failed", notification_type: "rent_reminder",
  recipient: "t@example.com", scheduled_for: "2026-11-01T10:00:00Z", attempt_count: 3, max_attempts: 3,
  channel: "email", body_text: "Pay rent.", failure_message: "SMTP refused" };
const SENT = { ...FAILED, id: "notif_s", status: "sent", failure_message: null };

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function buttonWithText(root, text) {
  return [...root.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("RentalCommunicationsPanel follow-up G24", () => {
  let container;
  let root;
  let posts;

  async function renderPanel(notifications) {
    posts = [];
    clearSWRCache();
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (options.method === "POST") {
        posts.push(JSON.parse(options.body || "{}"));
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ notifications, openCharges: [] }) };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<RentalCommunicationsPanel initialData={{ notifications, charges: [] }}
        initialEmailSettings={{ settings: null, readiness: { resendConfigured: false, workerConfigured: false, domainConfigured: false, verifiedDomain: null } }} />);
    });
    await flush();
  }

  afterEach(() => { act(() => { root?.unmount(); }); container?.remove(); vi.unstubAllGlobals(); });

  it("O-16: failed notification retries", async () => {
    await renderPanel([FAILED]);
    expect(container.textContent).toContain("SMTP refused");
    click(buttonWithText(container, "Retry delivery"));
    await flush();
    expect(posts[0]).toMatchObject({ operation: "retry-rent-notification", notificationId: "notif_f" });
    expect(container.textContent).toContain("Delivery queued again");
  });

  it("O-16: sent notification resends as a copy", async () => {
    await renderPanel([SENT]);
    click(buttonWithText(container, "Resend"));
    await flush();
    expect(posts[0]).toMatchObject({ operation: "resend-rent-notification", notificationId: "notif_s" });
    expect(container.textContent).toContain("Copy queued for resend");
  });
});
