# Financial Reporting Forge — Lessons Learned

## 1. IMMUTABLE DOMAIN OBJECTS

Financial report objects are immutable by design.

- Reports cannot be mutated
- Derived values cannot be overridden
- Object.freeze is intentional and enforced

---

## 2. SOURCE OF TRUTH RULE

All financial correctness must come from:

- AccountBalanceCollection (or equivalent source objects)

NOT from:
- Report methods
- Derived calculations
- Test overrides

---

## 3. TESTING RULE VIOLATIONS

❌ NEVER:
- Override report methods (e.g., netIncome = () => 999)
- Mutate frozen domain objects
- Simulate corruption at report layer

✔ ALWAYS:
- Modify source data only
- Construct real domain objects
- Validate derived output vs source input

---

## 4. VALIDATION ENGINE RULE

FinancialReportValidator:

- Must never mutate data
- Must compare derived report values to source truth
- Must reject only real inconsistencies

---

## 5. BUILD ERROR LESSON

Module errors (ERR_MODULE_NOT_FOUND) are caused by:

- inconsistent imports (.js vs no extension)
- missing files
- rapid refactor drift

Fix at file system level, not logic level.

---

## 6. EDITING SAFETY RULE

Avoid partial patch editing in complex files.

✔ Prefer:
- full file overwrite in nano or VS Code

Reason:
- prevents orphan code
- prevents syntax corruption
- ensures atomic correctness

---

## 7. TEST DESIGN RULE

If a test requires breaking immutability:

👉 The test is invalid, not the code

Valid tests must:
- respect domain constraints
- use only source data manipulation

---

## 8. DEBUG FLOW ORDER

1. Syntax check (vitest run)
2. Module resolution check
3. Logic validation
4. Source data inspection

---

## 9. CORE PRINCIPLE

> Reports are projections, not data sources.

---

## END OF FILE
