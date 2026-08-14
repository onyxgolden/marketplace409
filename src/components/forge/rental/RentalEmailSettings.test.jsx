import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalCommunicationsPanel, { EmailSettingsForm } from "./RentalCommunicationsPanel";

describe("rental email settings", () => {
  it("shows every missing prerequisite and locks activation", () => {
    const markup = renderToStaticMarkup(<EmailSettingsForm emailState={{ settings: null,
      readiness: { resendConfigured: false, workerConfigured: false, domainConfigured: false, verifiedDomain: null } }} onSubmit={() => {}} />);
    expect(markup).toContain("Needs setup · Resend API");
    expect(markup).toContain("Needs setup · Delivery worker");
    expect(markup).toContain("Activation stays locked");
    expect(markup).toContain('value="active" disabled=""');
  });

  it("shows the verified domain and permits the active option only when ready", () => {
    const markup = renderToStaticMarkup(<EmailSettingsForm emailState={{ settings: { status: "draft", sender_name: "FORGE Rentals",
      sender_email: "rentals@mail.409marketplace.online", transactional_enabled: true, reminders_enabled: false },
      readiness: { resendConfigured: true, workerConfigured: true, domainConfigured: true, verifiedDomain: "mail.409marketplace.online" } }} onSubmit={() => {}} />);
    expect(markup).toContain("Ready · mail.409marketplace.online");
    expect(markup).not.toContain('value="active" disabled=""');
  });

  it("clearly distinguishes active delivery from the fail-closed state", () => {
    const markup = renderToStaticMarkup(<RentalCommunicationsPanel initialData={{ notifications: [], charges: [] }}
      initialEmailSettings={{ settings: { status: "active" }, readiness: {} }} />);
    expect(markup).toContain("Email delivery is active");
    expect(markup).not.toContain("Nothing is sent until");
  });
});
