// Milestone dots for the retirement-number card's timeline chart.
//
// Pure function: derives the labeled milestones from the card's inputs.
// A milestone appears only when its inputs are present and its age falls
// inside [currentAge, planningAge] — no invented milestones.
// - "Retire" and the planning horizon always appear (they are the card's own inputs).
// - Social Security appears only when the user entered a monthly benefit.
// - Medicare at 65 appears whenever 65 is inside the window.
// - Mortgage payoff appears only when the user entered a payoff age.

export default function deriveRetirementMilestones({
  currentAge,
  retirementAge,
  planningAge,
  ssClaimAge = null,
  monthlySSBenefit = 0,
  mortgagePayoffAge = null,
}) {
  const lo = Number.isFinite(currentAge) ? currentAge : NaN;
  const retire = Number.isFinite(retirementAge) ? retirementAge : NaN;
  const hi = Number.isFinite(planningAge) ? planningAge : NaN;
  if (!Number.isFinite(lo) || !Number.isFinite(retire) || !Number.isFinite(hi) || hi < lo) {
    return [];
  }

  const inWindow = (age) => Number.isFinite(age) && age >= lo && age <= hi;

  const milestones = [];
  if (inWindow(retire)) {
    milestones.push({ key: "retire", age: retire, label: `Retire at ${retire}` });
  }
  if (monthlySSBenefit > 0 && inWindow(ssClaimAge)) {
    milestones.push({ key: "social-security", age: ssClaimAge, label: `Claim Social Security at ${ssClaimAge}` });
  }
  if (inWindow(65)) {
    milestones.push({ key: "medicare", age: 65, label: "Medicare at 65" });
  }
  if (inWindow(mortgagePayoffAge)) {
    milestones.push({ key: "mortgage", age: mortgagePayoffAge, label: `Mortgage paid off at ${mortgagePayoffAge}` });
  }
  if (inWindow(hi)) {
    milestones.push({ key: "planning", age: hi, label: `Plan spending to ${hi}` });
  }

  milestones.sort((a, b) => a.age - b.age);
  return milestones;
}
