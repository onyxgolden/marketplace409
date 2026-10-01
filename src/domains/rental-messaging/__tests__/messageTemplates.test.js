import { describe, expect, it, vi } from "vitest";
import {
  TEMPLATE_AUDIENCES,
  TEMPLATE_FIELDS,
  TEMPLATE_KINDS,
  SYSTEM_TEMPLATES,
  ensureSystemMessageTemplates,
  renderMessageTemplate,
  validateTemplateInput,
} from "../messageTemplates";

const FULL_FIELDS = {
  tenant_name: "Eric Carrillo",
  property_label: "308 Paula",
  balance_due: "$1,600.00",
  rent_due_date: "Oct 1, 2026",
  owner_name: "Brandy Morgan",
  work_order_scope: "Replace the kitchen faucet",
  contractor_name: "Acme Plumbing",
  scheduled_date: "Oct 2, 2026",
};

describe("renderMessageTemplate", () => {
  it("merges every known field", () => {
    const { text, missing, unknown } = renderMessageTemplate(
      "Hi {{tenant_name}}, {{balance_due}} is due {{rent_due_date}} for {{property_label}}. — {{owner_name}}",
      FULL_FIELDS,
    );
    expect(text).toBe("Hi Eric Carrillo, $1,600.00 is due Oct 1, 2026 for 308 Paula. — Brandy Morgan");
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("ignores whitespace inside the braces", () => {
    const { text } = renderMessageTemplate("Hi {{ tenant_name }},", FULL_FIELDS);
    expect(text).toBe("Hi Eric Carrillo,");
  });

  it("renders a missing field as empty and reports it once", () => {
    const { text, missing } = renderMessageTemplate(
      "{{tenant_name}} owes {{balance_due}} (again: {{balance_due}}).",
      { tenant_name: "Eric Carrillo" },
    );
    expect(text).toBe("Eric Carrillo owes  (again: ).");
    expect(missing).toEqual(["balance_due"]);
  });

  it("leaves unknown tokens verbatim and reports them", () => {
    const { text, missing, unknown } = renderMessageTemplate(
      "Hi {{tenant_name}}, your {{user_name}} is ready.",
      FULL_FIELDS,
    );
    expect(text).toBe("Hi Eric Carrillo, your {{user_name}} is ready.");
    expect(missing).toEqual([]);
    expect(unknown).toEqual(["user_name"]);
  });

  it("renders the subject line with the same contract", () => {
    const { text } = renderMessageTemplate("Rent reminder — {{property_label}}", FULL_FIELDS);
    expect(text).toBe("Rent reminder — 308 Paula");
  });

  it("handles empty and non-string input without throwing", () => {
    expect(renderMessageTemplate("", FULL_FIELDS)).toMatchObject({ text: "", missing: [], unknown: [] });
    expect(renderMessageTemplate(null, FULL_FIELDS)).toMatchObject({ text: "" });
    expect(renderMessageTemplate("Hi {{tenant_name}}", null).text).toBe("Hi ");
  });
});

describe("template catalog", () => {
  it("exposes the required minimum fields", () => {
    const keys = new Set(TEMPLATE_FIELDS.map((field) => field.key));
    for (const key of ["tenant_name", "property_label", "balance_due", "rent_due_date", "owner_name"]) {
      expect(keys.has(key), `missing required field ${key}`).toBe(true);
    }
  });

  it("keeps every field key a valid token name", () => {
    for (const field of TEMPLATE_FIELDS) {
      expect(field.key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(field.label).toBeTruthy();
    }
  });

  it("ships separate tenant and owner versions across both kinds", () => {
    const seen = new Set(SYSTEM_TEMPLATES.map((t) => `${t.kind}:${t.audience}`));
    expect(seen.has("text:tenant")).toBe(true);
    expect(seen.has("email:tenant")).toBe(true);
    expect(seen.has("email:owner")).toBe(true);
    expect(seen.has("text:owner")).toBe(true);
    for (const template of SYSTEM_TEMPLATES) {
      expect(TEMPLATE_KINDS).toContain(template.kind);
      expect(TEMPLATE_AUDIENCES).toContain(template.audience);
    }
  });

  it("uses only catalog fields in system template bodies and subjects", () => {
    const keys = new Set(TEMPLATE_FIELDS.map((field) => field.key));
    const tokens = (text) => [...String(text ?? "").matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]);
    for (const template of SYSTEM_TEMPLATES) {
      for (const token of [...tokens(template.body), ...tokens(template.subject)]) {
        expect(keys.has(token), `${template.systemKey} uses unknown field {{${token}}}`).toBe(true);
      }
      if (template.kind === "email") expect(template.subject, `${template.systemKey} email needs a subject`).toBeTruthy();
      else expect(template.subject, `${template.systemKey} text must not carry a subject`).toBeNull();
    }
  });

  it("keeps system keys unique and non-empty", () => {
    const keys = SYSTEM_TEMPLATES.map((t) => t.systemKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toBeTruthy();
  });
});

describe("ensureSystemMessageTemplates", () => {
  it("upserts the system catalog idempotently on (owner_id, system_key)", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabaseClient = { from: vi.fn(() => ({ upsert })) };
    await ensureSystemMessageTemplates({ supabaseClient, ownerId: "owner_1" });
    expect(supabaseClient.from).toHaveBeenCalledWith("rental_message_templates");
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(options).toMatchObject({ onConflict: "owner_id,system_key", ignoreDuplicates: true });
    expect(rows).toHaveLength(SYSTEM_TEMPLATES.length);
    for (const row of rows) {
      expect(row.owner_id).toBe("owner_1");
      expect(row.is_system).toBe(true);
      expect(row.system_key).toBeTruthy();
    }
  });

  it("surfaces seed failures", async () => {
    const supabaseClient = { from: () => ({ upsert: async () => ({ error: new Error("db down") }) }) };
    await expect(ensureSystemMessageTemplates({ supabaseClient, ownerId: "owner_1" })).rejects.toThrow(/seed system message templates/);
  });
});

describe("validateTemplateInput", () => {
  it("accepts a valid email template", () => {
    const result = validateTemplateInput({ name: "Nudge", kind: "email", audience: "tenant", subject: "Hi", body: "Hi {{tenant_name}}" });
    expect(result.ok).toBe(true);
    expect(result.clean).toMatchObject({ name: "Nudge", kind: "email", audience: "tenant", subject: "Hi" });
  });

  it("nulls the subject for text templates", () => {
    const result = validateTemplateInput({ name: "Nudge", kind: "text", audience: "tenant", subject: "ignored", body: "Hi" });
    expect(result.ok).toBe(true);
    expect(result.clean.subject).toBeNull();
  });

  it("rejects missing names, bad enums, and subject-less email", () => {
    expect(validateTemplateInput({ kind: "email", audience: "tenant", subject: "s", body: "b" }).ok).toBe(false);
    expect(validateTemplateInput({ name: "n", kind: "pager", audience: "tenant", body: "b" }).error).toMatch(/Kind must be/);
    expect(validateTemplateInput({ name: "n", kind: "text", audience: "vendor", body: "b" }).error).toMatch(/Audience must be/);
    expect(validateTemplateInput({ name: "n", kind: "email", audience: "tenant", body: "b" }).error).toMatch(/subject/);
    expect(validateTemplateInput({ name: "n", kind: "text", audience: "tenant", body: "  " }).error).toMatch(/body is required/);
  });

  it("allows the mailing kind for the future Mailing Manager slice", () => {
    const result = validateTemplateInput({ name: "Letter", kind: "mailing", audience: "tenant", body: "Dear {{tenant_name}}" });
    expect(result.ok).toBe(true);
    expect(result.clean.kind).toBe("mailing");
  });
});
