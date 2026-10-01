// Rentec parity R21 — application-form domain (server-side, framework-free).
//
// Rentec's application builder lets the owner decide which sections an
// applicant fills in (personal info, residence history, employment,
// references) plus custom questions and an application fee. This module owns
// the form config shape, its validation, and validation of a submitted
// application against the owning form.
//
// Custom questions are standalone JSON in this slice. If the R15
// custom-fields system lands on main later, the unification point is the
// customQuestions array: map R15 field definitions into { key, label, type,
// required, options } and reuse validateApplicationPayload unchanged.

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const QUESTION_TYPES = ["text", "textarea", "select", "checkbox"];

export const FORM_SECTIONS = Object.freeze([
  "personal_info",
  "residence_history",
  "employment",
  "references",
]);

export const DEFAULT_FORM_SECTIONS = Object.freeze({
  personal_info: true,
  residence_history: true,
  employment: true,
  references: true,
});

export const DEFAULT_CONSENT_TEXT = "I authorize the property owner to run "
  + "tenant screening (credit, criminal, and eviction history) as part of this "
  + "application. I understand the application fee is non-refundable.";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// A 12-char URL-safe slug: the public listing URL (/rentals/<slug>) must never
// expose the internal unit id.
export function generatePublicSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[b % 62]).join("");
}

export function validateCustomQuestion(question, index) {
  if (!isPlainObject(question)) return `Question ${index + 1} must be an object.`;
  if (!isNonEmptyString(question.key)) return `Question ${index + 1} needs a key.`;
  if (!/^[a-z0-9_]{1,40}$/.test(question.key)) return `Question "${question.key}" has an invalid key (a-z, 0-9, _).`;
  if (!isNonEmptyString(question.label)) return `Question ${index + 1} needs a label.`;
  if (!QUESTION_TYPES.includes(question.type)) {
    return `Question "${question.key}" has an invalid type (one of ${QUESTION_TYPES.join(", ")}).`;
  }
  if (question.type === "select") {
    if (!Array.isArray(question.options) || question.options.length < 2
      || !question.options.every((option) => isNonEmptyString(option))) {
      return `Question "${question.key}" needs at least two non-empty options.`;
    }
  }
  return null;
}

export function validateFormInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return ["Form input is required."];
  if (!isNonEmptyString(input.name)) errors.push("The form needs a name.");
  if (input.sections !== undefined) {
    if (!isPlainObject(input.sections)) errors.push("sections must be an object.");
    else for (const section of FORM_SECTIONS) {
      if (input.sections[section] !== undefined && typeof input.sections[section] !== "boolean") {
        errors.push(`sections.${section} must be true or false.`);
      }
    }
  }
  if (input.customQuestions !== undefined) {
    if (!Array.isArray(input.customQuestions)) errors.push("customQuestions must be an array.");
    else {
      const keys = new Set();
      input.customQuestions.forEach((question, index) => {
        const error = validateCustomQuestion(question, index);
        if (error) errors.push(error);
        else if (keys.has(question.key)) errors.push(`Duplicate custom question key "${question.key}".`);
        else keys.add(question.key);
      });
    }
  }
  if (input.feeAmountCents !== undefined) {
    if (!Number.isSafeInteger(input.feeAmountCents) || input.feeAmountCents < 0) {
      errors.push("The application fee must be a non-negative whole number of cents.");
    }
  }
  if (input.consentText !== undefined && input.consentText !== null && typeof input.consentText !== "string") {
    errors.push("consentText must be text.");
  }
  return errors;
}

export function normalizeFormInput(input) {
  const sections = { ...DEFAULT_FORM_SECTIONS };
  if (isPlainObject(input.sections)) {
    for (const section of FORM_SECTIONS) {
      if (typeof input.sections[section] === "boolean") sections[section] = input.sections[section];
    }
  }
  return {
    name: input.name.trim(),
    isDefault: input.isDefault === true,
    sections,
    customQuestions: Array.isArray(input.customQuestions) ? input.customQuestions : [],
    feeAmountCents: Number.isSafeInteger(input.feeAmountCents) && input.feeAmountCents >= 0 ? input.feeAmountCents : 0,
    consentText: typeof input.consentText === "string" && input.consentText.trim() ? input.consentText.trim() : DEFAULT_CONSENT_TEXT,
  };
}

function requireFields(errors, prefix, obj, fields) {
  for (const field of fields) {
    if (!isNonEmptyString(obj?.[field])) errors.push(`${prefix}: ${field} is required.`);
  }
}

// Validates an applicant's payload against the owning form's config. Returns
// an array of human-readable errors (empty = valid). The fee is record-only:
// nothing here collects money.
export function validateApplicationPayload(form, payload) {
  const errors = [];
  if (!isPlainObject(payload)) return ["Application answers are required."];
  const sections = form?.sections || DEFAULT_FORM_SECTIONS;
  const customQuestions = Array.isArray(form?.customQuestions) ? form.customQuestions : [];

  if (sections.personal_info !== false) {
    const personal = payload.personal;
    requireFields(errors, "Personal info", personal, ["firstName", "lastName", "phone"]);
    if (!EMAIL_RE.test(String(personal?.email || "").trim())) errors.push("Personal info: a valid email is required.");
  }
  if (sections.residence_history !== false) {
    const current = payload.residence?.current;
    requireFields(errors, "Current residence", current, ["address", "city", "state", "landlordName"]);
    if (current?.monthlyRent !== undefined && current?.monthlyRent !== null && current?.monthlyRent !== "") {
      const rent = Number(current.monthlyRent);
      if (!Number.isFinite(rent) || rent < 0) errors.push("Current residence: monthly rent must be a non-negative number.");
    }
  }
  if (sections.employment !== false) {
    const job = payload.employment?.current;
    requireFields(errors, "Current employment", job, ["employerName", "jobTitle"]);
    if (job?.monthlyIncome !== undefined && job?.monthlyIncome !== null && job?.monthlyIncome !== "") {
      const income = Number(job.monthlyIncome);
      if (!Number.isFinite(income) || income < 0) errors.push("Current employment: monthly income must be a non-negative number.");
    }
  }
  if (sections.references !== false) {
    const references = Array.isArray(payload.references) ? payload.references : [];
    const usable = references.filter((ref) => isPlainObject(ref) && (isNonEmptyString(ref.name) || isNonEmptyString(ref.phone)));
    if (usable.length === 0) errors.push("References: at least one reference with a name and phone is required.");
    else usable.forEach((ref, index) => {
      if (!isNonEmptyString(ref.name)) errors.push(`Reference ${index + 1}: name is required.`);
      if (!isNonEmptyString(ref.phone)) errors.push(`Reference ${index + 1}: phone is required.`);
    });
  }
  const custom = isPlainObject(payload.custom) ? payload.custom : {};
  for (const question of customQuestions) {
    const answer = custom[question.key];
    if (question.required) {
      const answered = question.type === "checkbox" ? answer === true : isNonEmptyString(answer);
      if (!answered) errors.push(`"${question.label}" is required.`);
    }
    if (question.type === "select" && isNonEmptyString(answer) && !question.options.includes(answer)) {
      errors.push(`"${question.label}" must be one of the listed options.`);
    }
  }
  // Screening consent is collected here; the actual checks are R22.
  if (payload.consent !== true) errors.push("Screening consent is required before submitting.");
  return errors;
}

// Pure rate-limit predicate so the guard is unit-testable without a database.
// recentSubmissions: sorted-desc timestamps (ms) of this IP+listing's submits.
export const APPLICATION_RATE_LIMIT = Object.freeze({ windowMs: 60 * 60 * 1000, maxSubmissions: 5 });

export function isRateLimited({ recentSubmissions = [], now = Date.now() } = {}) {
  const windowStart = now - APPLICATION_RATE_LIMIT.windowMs;
  const inWindow = recentSubmissions.filter((ts) => Number(ts) >= windowStart);
  return inWindow.length >= APPLICATION_RATE_LIMIT.maxSubmissions;
}

// Honeypot: bots fill it, humans never see it.
export function isHoneypotTripped(payload) {
  return isNonEmptyString(payload?.company);
}
