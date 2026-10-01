import { describe, expect, it } from "vitest";
import {
  APPLICATION_RATE_LIMIT,
  DEFAULT_CONSENT_TEXT,
  generatePublicSlug,
  isHoneypotTripped,
  isRateLimited,
  normalizeFormInput,
  validateApplicationPayload,
  validateCustomQuestion,
  validateFormInput,
} from "../applicationForms";

const validForm = () => ({
  sections: { personal_info: true, residence_history: true, employment: true, references: true },
  customQuestions: [
    { key: "pets", label: "Do you have pets?", type: "select", required: true, options: ["Yes", "No"] },
    { key: "move_in", label: "Desired move-in date", type: "text", required: false },
    { key: "smoker", label: "Non-smoker?", type: "checkbox", required: true },
  ],
});

const validPayload = () => ({
  personal: { firstName: "Sam", lastName: "Applicant", email: "sam@example.com", phone: "555-0100" },
  residence: { current: { address: "1 Main St", city: "Beaumont", state: "TX", landlordName: "Prior LLC", monthlyRent: 1200 } },
  employment: { current: { employerName: "Refinery Co", jobTitle: "Operator", monthlyIncome: 6500 } },
  references: [{ name: "Rita Ref", phone: "555-0101" }],
  custom: { pets: "No", move_in: "2026-11-01", smoker: true },
  consent: true,
});

describe("application form validation", () => {
  it("accepts a well-formed builder config", () => {
    expect(validateFormInput({ name: "Standard application", feeAmountCents: 5000 })).toEqual([]);
  });

  it("rejects a missing name, negative fee, and bad custom questions", () => {
    const errors = validateFormInput({
      name: "  ",
      feeAmountCents: -1,
      sections: { personal_info: "yes" },
      customQuestions: [
        { key: "bad key!", label: "X", type: "text" },
        { key: "dup", label: "A", type: "select", options: ["only-one"] },
        { key: "dup", label: "B", type: "text" },
      ],
    });
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join(" ")).toMatch(/name/i);
    expect(errors.join(" ")).toMatch(/non-negative/);
  });

  it("normalizes defaults and falls back to the standard consent text", () => {
    const normalized = normalizeFormInput({ name: "  Basic  " });
    expect(normalized.name).toBe("Basic");
    expect(normalized.feeAmountCents).toBe(0);
    expect(normalized.consentText).toBe(DEFAULT_CONSENT_TEXT);
    expect(normalized.sections).toEqual({ personal_info: true, residence_history: true, employment: true, references: true });
  });
});

describe("application payload validation", () => {
  it("accepts a complete, consenting application", () => {
    expect(validateApplicationPayload(validForm(), validPayload())).toEqual([]);
  });

  it("requires personal info, email validity, and consent", () => {
    const payload = validPayload();
    payload.personal.email = "not-an-email";
    payload.personal.firstName = "";
    payload.consent = false;
    const errors = validateApplicationPayload(validForm(), payload);
    expect(errors).toContain("Personal info: firstName is required.");
    expect(errors).toContain("Personal info: a valid email is required.");
    expect(errors).toContain("Screening consent is required before submitting.");
  });

  it("validates residence, employment, and references sections", () => {
    const payload = validPayload();
    payload.residence.current.landlordName = "";
    payload.residence.current.monthlyRent = -50;
    payload.employment.current.monthlyIncome = "lots";
    payload.references = [];
    const errors = validateApplicationPayload(validForm(), payload);
    expect(errors).toContain("Current residence: landlordName is required.");
    expect(errors.join(" ")).toMatch(/monthly rent must be a non-negative number/);
    expect(errors.join(" ")).toMatch(/monthly income must be a non-negative number/);
    expect(errors).toContain("References: at least one reference with a name and phone is required.");
  });

  it("enforces required custom questions and select options", () => {
    const payload = validPayload();
    payload.custom = { pets: "Maybe", smoker: false };
    const errors = validateApplicationPayload(validForm(), payload);
    expect(errors).toContain("\"Do you have pets?\" must be one of the listed options.");
    expect(errors).toContain("\"Non-smoker?\" is required.");
  });

  it("skips sections the owner turned off", () => {
    const form = validForm();
    form.sections = { personal_info: true, residence_history: false, employment: false, references: false };
    form.customQuestions = [];
    const payload = { personal: validPayload().personal, consent: true };
    expect(validateApplicationPayload(form, payload)).toEqual([]);
  });
});

describe("public slug generation", () => {
  it("generates unique 12-char URL-safe slugs", () => {
    const slugs = new Set(Array.from({ length: 200 }, generatePublicSlug));
    expect(slugs.size).toBe(200);
    for (const slug of slugs) expect(slug).toMatch(/^[a-zA-Z0-9]{12}$/);
  });
});

describe("spam guards", () => {
  it("flags the honeypot only when filled", () => {
    expect(isHoneypotTripped({ company: "bot co" })).toBe(true);
    expect(isHoneypotTripped({})).toBe(false);
    expect(isHoneypotTripped({ company: "   " })).toBe(false);
  });

  it("rate-limits at the configured threshold inside the window", () => {
    const now = 1_800_000_000_000;
    const recent = Array.from({ length: APPLICATION_RATE_LIMIT.maxSubmissions }, (_, i) => now - i * 60_000);
    expect(isRateLimited({ recentSubmissions: recent, now })).toBe(true);
    expect(isRateLimited({ recentSubmissions: recent.slice(1), now })).toBe(false);
    // Old submissions outside the window do not count.
    const stale = recent.map((ts) => ts - APPLICATION_RATE_LIMIT.windowMs);
    expect(isRateLimited({ recentSubmissions: stale, now })).toBe(false);
  });
});

describe("validateCustomQuestion edge cases", () => {
  it("rejects non-objects and bad types", () => {
    expect(validateCustomQuestion(null, 0)).toMatch(/must be an object/);
    expect(validateCustomQuestion({ key: "q", label: "Q", type: "radio" }, 0)).toMatch(/invalid type/);
  });
});
