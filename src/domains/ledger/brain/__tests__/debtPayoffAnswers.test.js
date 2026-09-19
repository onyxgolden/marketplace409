import { describe, expect, it } from "vitest";

import { compareDebtPayoffStrategies } from "../debtPayoff.js";
import {
  DEBT_QUESTION_CHIPS,
  answerDebtFreeWhen,
  answerDebtQuestion,
  answerInterestSaved,
  answerTargetFirst,
  answerWhatIf,
} from "../debtPayoffAnswers.js";

const debts = [
  { id: "a", name: "High Rate Card", balance: 1000, apr: 24, minimumPayment: 75 },
  { id: "b", name: "Low Rate Card", balance: 500, apr: 6, minimumPayment: 25 },
];

const comparison = () => compareDebtPayoffStrategies({ debts, monthlySurplus: 100 });

describe("answerTargetFirst", () => {
  it("names the highest-rate debt and its savings from the top move", () => {
    const answer = answerTargetFirst(comparison());
    expect(answer).toContain("High Rate Card");
    expect(answer).toContain("24.00%");
    expect(answer).toContain("$100.00/mo");
    expect(answer).toContain("vs minimums-only");
  });

  it("says so instead of guessing when no debts have confirmed terms", () => {
    const empty = compareDebtPayoffStrategies({ debts: [], monthlySurplus: 100 });
    expect(answerTargetFirst(empty)).toContain("can't pick a target yet");
  });
});

describe("answerInterestSaved", () => {
  it("quotes the avalanche savings against the minimums baseline", () => {
    const cmp = comparison();
    const answer = answerInterestSaved(cmp, "avalanche");
    expect(answer).toContain("Avalanche saves $");
    expect(answer).toContain("vs minimums-only");
    // The dollar figure must match the engine's own number, not a guess.
    expect(answer).toContain(
      `$${cmp.interestSavedVsMinimums.avalanche.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`,
    );
  });

  it("describes minimums-only as the baseline when selected", () => {
    expect(answerInterestSaved(comparison(), "minimums")).toContain("Minimums-only is the baseline");
  });

  it("admits there is no finite number when minimums never converge", () => {
    const cmp = compareDebtPayoffStrategies({
      debts: [{ id: "x", name: "Hopeless", balance: 10000, apr: 24, minimumPayment: 50 }],
      monthlySurplus: 100,
    });
    expect(cmp.interestSavedVsMinimums.avalanche).toBeNull();
    expect(answerInterestSaved(cmp, "avalanche")).toContain("never pays these debts off");
  });
});

describe("answerDebtFreeWhen", () => {
  it("gives per-strategy timing from the engine month counts", () => {
    const cmp = comparison();
    const answer = answerDebtFreeWhen(cmp);
    expect(answer).toContain(`Avalanche: debt-free in ${cmp.strategies.avalanche.monthsToDebtFree} months`);
    expect(answer).toContain(`Snowball: debt-free in ${cmp.strategies.snowball.monthsToDebtFree} months`);
    expect(answer).toContain(`Minimums-only: debt-free in ${cmp.strategies.minimums.monthsToDebtFree} months`);
  });

  it("says never when minimums don't cover interest", () => {
    const cmp = compareDebtPayoffStrategies({
      debts: [{ id: "x", name: "Hopeless", balance: 10000, apr: 24, minimumPayment: 50 }],
      monthlySurplus: 0,
    });
    expect(answerDebtFreeWhen(cmp)).toContain("Minimums-only: never");
  });

  it("asks for terms when there is nothing to rank", () => {
    const empty = compareDebtPayoffStrategies({ debts: [], monthlySurplus: 0 });
    expect(answerDebtFreeWhen(empty)).toContain("No debts with confirmed terms yet");
  });
});

describe("answerWhatIf", () => {
  it("re-runs the engine with the hypothetical payment and quotes the outcome", () => {
    const answer = answerWhatIf({ debts, extraPerMonth: 300, marginalTaxRate: 0 });
    const expected = compareDebtPayoffStrategies({ debts, monthlySurplus: 300, marginalTaxRate: 0 });
    expect(answer).toContain("With $300.00/mo extra");
    expect(answer).toContain(`in ${expected.strategies.avalanche.monthsToDebtFree} months`);
  });

  it("says so when the hypothetical payment still doesn't pay the debts off", () => {
    const answer = answerWhatIf({
      debts: [{ id: "x", name: "Hopeless", balance: 10000, apr: 24, minimumPayment: 50 }],
      extraPerMonth: 10,
    });
    expect(answer).toContain("still don't pay off");
  });

  it("rejects non-numeric input without fabricating a number", () => {
    expect(answerWhatIf({ debts, extraPerMonth: "lots" })).toContain("non-negative dollar amount");
    expect(answerWhatIf({ debts, extraPerMonth: -5 })).toContain("non-negative dollar amount");
  });

  it("asks for terms when there are no debts to model", () => {
    expect(answerWhatIf({ debts: [], extraPerMonth: 500 })).toContain("nothing to model yet");
  });
});

describe("answerDebtQuestion dispatcher", () => {
  it("exposes the four preselected questions", () => {
    expect(DEBT_QUESTION_CHIPS.map((chip) => chip.id)).toEqual([
      "target-first",
      "interest-saved",
      "debt-free-when",
      "what-if",
    ]);
  });

  it("routes each chip to its answer", () => {
    const cmp = comparison();
    expect(answerDebtQuestion("target-first", { comparison: cmp })).toContain("High Rate Card");
    expect(answerDebtQuestion("interest-saved", { comparison: cmp, strategy: "snowball" })).toContain(
      "Snowball saves $",
    );
    expect(answerDebtQuestion("debt-free-when", { comparison: cmp })).toContain("Avalanche:");
    expect(
      answerDebtQuestion("what-if", { debts, extraPerMonth: 200, marginalTaxRate: 0 }),
    ).toContain("With $200.00/mo extra");
  });

  it("returns null for unknown question ids", () => {
    expect(answerDebtQuestion("tell-me-a-secret", { comparison: comparison() })).toBeNull();
  });
});
