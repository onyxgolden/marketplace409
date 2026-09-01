import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivateFinancingBorrowerInvite from "./PrivateFinancingBorrowerInvite";
import PrivateFinancingOnlinePaymentControl from "./PrivateFinancingOnlinePaymentControl";

describe("private-financing admin controls", () => {
  it("keeps borrower invitation text readable in dark mode", () => {
    const markup = renderToStaticMarkup(
      <PrivateFinancingBorrowerInvite accountId="account-1" />,
    );

    expect(markup).toContain("dark:text-slate-100");
    expect(markup).toContain("dark:bg-slate-800");
    expect(markup).toContain("dark:text-slate-100");
    expect(markup).toContain("Invite a borrower");
  });

  it("keeps online-payment text and actions readable in dark mode", () => {
    const markup = renderToStaticMarkup(
      <PrivateFinancingOnlinePaymentControl
        accountId="account-1"
        settings={{ enabled: true }}
      />,
    );

    expect(markup).toContain("dark:text-slate-100");
    expect(markup).toContain("dark:text-slate-300");
    expect(markup).toContain("text-slate-950");
    expect(markup).toContain("Pause online payments");
  });
});
