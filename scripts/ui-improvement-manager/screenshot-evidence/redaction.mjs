// Automatic masking hooks (FB-UI-1 requirement 11: "email addresses, account numbers, tenant names,
// borrower names, and financial identifiers"). Two complementary mechanisms, because they need to
// cover two different kinds of sensitive data:
//
// 1. TEXT_REDACTION_RULES -- regex patterns over rendered text, for values that have a recognizable
//    *shape* regardless of which component rendered them (an email address, an account/routing
//    number, an SSN). Works on any page with no markup changes required.
// 2. SENSITIVE_SELECTORS -- an opt-in `data-fb-ui-sensitive="<category>"` attribute convention, for
//    values with NO recognizable shape (a tenant's or borrower's actual name is just a string; no
//    regex can tell "Malissa Saavedra" apart from ordinary page copy). This convention is proposed by
//    this checkpoint and is not yet adopted anywhere in the application -- until a component opts in,
//    a name rendered without this attribute will not be masked by mechanism 2. This gap is called out
//    explicitly in the FB-UI-1 report rather than silently assumed away.
//
// Every pattern is defined once, as a {name, source, flags} triple, so the exact same regex can be
// unit-tested directly in Node (redactText) and reconstructed byte-for-byte inside the browser-context
// script this module builds for Playwright (buildRedactionInitScript) -- one source of truth, not two
// implementations that could quietly drift apart.

export const TEXT_REDACTION_RULES = Object.freeze([
  { name: "email", source: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", flags: "g" },
  { name: "ssn_like", source: "\\b\\d{3}-\\d{2}-\\d{4}\\b", flags: "g" },
  { name: "ein_like", source: "\\b\\d{2}-\\d{7}\\b", flags: "g" },
  { name: "card_like", source: "\\b\\d{4}[ -]\\d{4}[ -]\\d{4}[ -]\\d{1,7}\\b", flags: "g" },
  // Generic 8-17 digit run: covers typical US bank account and routing numbers, which (unlike SSNs
  // or cards) have no universal delimiter convention to anchor on -- deliberately broad, since a
  // false-positive mask (blacking out a non-sensitive number) is the safe failure direction here,
  // never a false-negative miss.
  { name: "financial_identifier_like", source: "\\b\\d{8,17}\\b", flags: "g" },
]);

export const SENSITIVE_SELECTOR_CATEGORIES = Object.freeze([
  "tenant-name", "borrower-name", "account-number", "financial-identifier",
]);

export const SENSITIVE_SELECTORS = Object.freeze(
  SENSITIVE_SELECTOR_CATEGORIES.map((category) => `[data-fb-ui-sensitive="${category}"]`),
);

const MASK_TOKEN = (name) => `[REDACTED:${name}]`;

export function redactText(text) {
  if (typeof text !== "string" || text.length === 0) return text;
  let redacted = text;
  const applied = [];
  for (const rule of TEXT_REDACTION_RULES) {
    const pattern = new RegExp(rule.source, rule.flags);
    if (pattern.test(redacted)) {
      applied.push(rule.name);
      redacted = redacted.replace(new RegExp(rule.source, rule.flags), MASK_TOKEN(rule.name));
    }
  }
  return Object.freeze({ text: redacted, rulesApplied: Object.freeze(applied) });
}

// The marker mechanism 8 (fail-closed verification) checks for on `document.documentElement` after
// injection, proving the script actually ran rather than the caller merely having attempted to run it.
export const REDACTION_APPLIED_ATTRIBUTE = "data-fb-ui-redaction-applied";

// Builds the literal JS source Playwright evaluates in the page. Deliberately a plain string (not a
// closure passed to page.evaluate directly) so it can also be unit-tested for shape/content without a
// browser -- see __tests__/redaction.test.mjs's "script shape" tests.
export function buildRedactionInitScript() {
  const rules = JSON.stringify(TEXT_REDACTION_RULES);
  const selectors = JSON.stringify(SENSITIVE_SELECTORS);
  const attribute = JSON.stringify(REDACTION_APPLIED_ATTRIBUTE);
  return `(() => {
    const rules = ${rules};
    const selectors = ${selectors};
    const maskToken = (name) => "[REDACTED:" + name + "]";
    function redactWalker(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        let value = node.nodeValue;
        for (const rule of rules) {
          const pattern = new RegExp(rule.source, rule.flags);
          value = value.replace(pattern, maskToken(rule.name));
        }
        if (value !== node.nodeValue) node.nodeValue = value;
      }
    }
    redactWalker(document.body);
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((el) => {
        el.textContent = "[REDACTED]";
        el.style.filter = "blur(6px)";
      });
    }
    document.documentElement.setAttribute(${attribute}, "true");
  })();`;
}

export class RedactionVerificationError extends Error {
  constructor(reason) {
    super(`Screenshot redaction could not be verified: ${reason}`);
    this.name = "RedactionVerificationError";
  }
}

// Injects the redaction script and verifies it actually ran, in one step -- FB-UI-1 requirement 8
// ("fail closed when ... screenshot redaction cannot be established"). `page` is a Playwright
// Page-shaped object; tests supply a mock with `evaluate` and `getAttribute`.
export async function applyAndVerifyRedaction(page) {
  await page.evaluate(buildRedactionInitScript());
  const applied = await page.evaluate(
    (attribute) => document.documentElement.getAttribute(attribute),
    REDACTION_APPLIED_ATTRIBUTE,
  );
  if (applied !== "true") throw new RedactionVerificationError("verification attribute was not set after injection");
  return true;
}
