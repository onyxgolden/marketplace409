// axe-core checks for the smoke suite.
//
// Rule (scope §5): any CRITICAL violation fails the test. SERIOUS
// violations are recorded (test annotation + console report) and tracked,
// and are promoted to failing once the first baseline is triaged — they are
// never silently waived and never auto-fixed by the suite.
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function expectNoCriticalViolations(page, label, testInfo) {
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");
  if (serious.length > 0) {
    const summary = serious.map((v) => `${v.id} (${v.nodes.length} nodes)`).join("; ");
    testInfo.annotations.push({ type: "axe-serious", description: `${label}: ${summary}` });
    console.log(`[axe-serious] ${label}: ${summary}`);
  }
  expect(
    critical,
    `${label}: critical axe violations: ${critical.map((v) => `${v.id} (${v.nodes.length} nodes)`).join("; ")}`,
  ).toEqual([]);
}
