import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/domains/rental-mailing/letterContext", () => ({ resolveLetterTemplateContext: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { resolveLetterTemplateContext } from "@/domains/rental-mailing/letterContext";
import { POST as render } from "./route";

function makeDb({ templateRow = null } = {}) {
  const table = {
    select() { return table; },
    eq() { return table; },
    async maybeSingle() { return { data: templateRow, error: null }; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  return { db: { from: vi.fn(() => table) } };
}

const MAILING_TEMPLATE = {
  id: "tpl_mail", kind: "mailing", subject: "Past-due rent — {{property_label}}",
  body: "Dear {{tenant_name}}, you owe {{balance_due}}. {{mystery}}",
};

const post = (body) => render(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  resolveLetterTemplateContext.mockResolvedValue({
    fields: {
      tenant_name: "Eric Carrillo",
      tenant_address: "308 Paula\nHouston, TX",
      property_label: "308 Paula",
      balance_due: "$1,600.00",
      letter_date: "Oct 1, 2026",
    },
  });
});

function authAs(db) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: db,
  });
}

describe("mailing render route", () => {
  it("400s missing templateId or tenantId", async () => {
    const { db } = makeDb();
    authAs(db);
    expect((await post({})).status).toBe(400);
    expect((await post({ templateId: "tpl_mail" })).status).toBe(400);
  });

  it("404s an unknown template and 400s a non-mailing template", async () => {
    const { db } = makeDb({ templateRow: null });
    authAs(db);
    expect((await post({ templateId: "nope", tenantId: "t1" })).status).toBe(404);
    const { db: db2 } = makeDb({ templateRow: { ...MAILING_TEMPLATE, kind: "email" } });
    authAs(db2);
    expect((await post({ templateId: "tpl_mail", tenantId: "t1" })).status).toBe(400);
  });

  it("renders the letter with real data and reports missing/unknown fields", async () => {
    const { db } = makeDb({ templateRow: MAILING_TEMPLATE });
    authAs(db);
    const res = await post({ templateId: "tpl_mail", tenantId: "t1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body).toContain("Dear Eric Carrillo, you owe $1,600.00.");
    expect(body.subject).toBe("Past-due rent — 308 Paula");
    expect(body.unknownFields).toEqual(["mystery"]);
  });

  it("honors recipientAddress and returnAddress overrides", async () => {
    const { db } = makeDb({
      templateRow: { id: "tpl_mail", kind: "mailing", subject: null, body: "{{owner_return_address}}\n{{tenant_address}}" },
    });
    authAs(db);
    const res = await post({
      templateId: "tpl_mail", tenantId: "t1",
      returnAddress: "Owner\n1 Main St", recipientAddress: "PO Box 9",
    });
    const body = await res.json();
    expect(body.body).toContain("Owner\n1 Main St");
    expect(body.body).toContain("PO Box 9");
  });
});
