import { Budget, BUDGET_LIMITS, BudgetExceededError, ControlDataError } from "./budgets.js";

describe("invocation budget — charge before inspection, exact/+1 sentinels", () => {
  it("admits exactly 64 candidates; candidate 65 dies on the charge alone", () => {
    const b = new Budget();
    for (let i = 0; i < 64; i++) b.measureCandidate({ n: i });
    expect(b.used.candidates).toBe(64);
    // Candidate 65 is structurally INVALID (accessor) — the refusal must
    // still be BUDGET_EXCEEDED, proving the charge precedes inspection.
    const evil = {};
    Object.defineProperty(evil, "x", { enumerable: true, get() { throw new Error("getter invoked"); } });
    expect(() => b.measureCandidate(evil)).toThrow(BudgetExceededError);
    try { b.measureCandidate({ n: 65 }); } catch (e) { expect(e.code).toBe("BUDGET_EXCEEDED"); expect(e.kind).toBe("candidates"); }
  });

  it("refuses an accessor-bearing candidate without invoking the getter", () => {
    const b = new Budget();
    let invoked = 0;
    const evil = {};
    Object.defineProperty(evil, "x", { enumerable: true, get() { invoked += 1; return 1; } });
    expect(() => b.measureCandidate(evil)).toThrow(ControlDataError);
    expect(invoked).toBe(0);
  });

  it("refuses a Proxy candidate without invoking its traps", () => {
    const b = new Budget();
    let trapped = 0;
    const p = new Proxy({}, { get() { trapped += 1; return undefined; }, ownKeys() { trapped += 1; return []; } });
    expect(() => b.measureCandidate(p)).toThrow(ControlDataError);
    expect(trapped).toBe(0);
  });

  it("charges serialized UTF-8 bytes including JSON escaping inflation", () => {
    const b = new Budget({ ...BUDGET_LIMITS, inputBytes: 12 });
    // {"a":"\n"} serializes with an escaped newline: 10 bytes.
    expect(b.measureCandidate({ a: "\n" }).bytes).toBe(10);
    expect(() => b.measureCandidate({ a: "ééé" })).toThrow(BudgetExceededError);
  });

  it("enforces depth exactly at the cap and refuses beyond it", () => {
    const nest = (n) => (n === 0 ? 1 : { a: nest(n - 1) });
    const ok = new Budget();
    expect(() => ok.measureCandidate(nest(15))).not.toThrow();
    const over = new Budget();
    expect(() => over.measureCandidate(nest(16))).toThrow(BudgetExceededError);
  });

  it("enforces output record and byte caps exactly", () => {
    const b = new Budget();
    b.chargeOutput(256, 100);
    expect(() => b.chargeOutput(1, 100)).toThrow(BudgetExceededError);
    const b2 = new Budget();
    expect(() => b2.chargeOutput(1, BUDGET_LIMITS.outputBytes + 1)).toThrow(BudgetExceededError);
  });

  it("enforces the evidence span cap at 512/+1", () => {
    const b = new Budget();
    for (let i = 0; i < 512; i++) b.chargeEvidenceSpan();
    expect(() => b.chargeEvidenceSpan()).toThrow(BudgetExceededError);
  });
});
