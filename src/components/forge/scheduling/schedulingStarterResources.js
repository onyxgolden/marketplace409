// Starter resource sets for the Resources modal's "Load starter resources" action (SCHED-17).
// Pure data, same spirit as schedulingBoardState.js's PROJECT_TEMPLATES chip/lane sets, but for
// the owner-global resource dictionary (schedule_resources) instead of a project's own board --
// keyed by the same template ids so a set can default to "whatever this project's own template
// is," while still letting the caller load a different one (the dictionary is shared across every
// project, not scoped to the one it was opened from).
//
// Units/rates: labor maxUnitsPerDay is hours/day (8 = one shift), stdRate is $/hour. nonlabor
// (equipment/rentals) maxUnitsPerDay is 1 (one of it, available or not, per day), stdRate is
// $/day. material has no meaningful daily cap -- maxUnitsPerDay is a large placeholder -- stdRate
// is $ per unitOfMeasure. None of this is enforced; every value is just a sane starting point the
// owner edits or deletes like any other resource once loaded.

function labor(name, stdRate, maxUnitsPerDay = 8) {
  return Object.freeze({ name, resourceType: "labor", unitOfMeasure: null, maxUnitsPerDay, stdRate });
}
function nonlabor(name, stdRate, maxUnitsPerDay = 1) {
  return Object.freeze({ name, resourceType: "nonlabor", unitOfMeasure: null, maxUnitsPerDay, stdRate });
}
function material(name, unitOfMeasure, stdRate) {
  return Object.freeze({ name, resourceType: "material", unitOfMeasure, maxUnitsPerDay: 999999, stdRate });
}

export const STARTER_RESOURCE_SETS = Object.freeze({
  standard: Object.freeze([
    labor("Project Manager", 85),
    labor("Design Engineer", 75),
    labor("General Labor Crew", 45),
    labor("QA / QC Inspector", 60),
    nonlabor("Equipment Rental", 350),
    material("General Materials", "lot", 1000),
  ]),
  capital: Object.freeze([
    labor("Project Engineer", 90),
    labor("Pipefitter Crew", 65),
    labor("Electrician Crew", 65),
    labor("Instrument Tech Crew", 70),
    labor("Millwright Crew", 65),
    labor("QA / QC Inspector", 60),
    labor("Safety Officer", 55),
    nonlabor("Crane", 1500),
    nonlabor("Scaffolding", 800),
    material("Piping Material", "lf", 40),
    material("Structural Steel", "ton", 2200),
    material("Insulation Material", "sf", 8),
  ]),
  home_remodel: Object.freeze([
    labor("General Contractor Crew", 70),
    labor("Plumber", 65),
    labor("Electrician", 65),
    labor("HVAC Tech", 65),
    labor("Framing Crew", 55),
    labor("Drywall Crew", 45),
    labor("Painter", 40),
    labor("Flooring Installer", 45),
    labor("Tile Installer", 50),
    nonlabor("Dumpster / Waste Removal", 450),
    material("Lumber", "bf", 3),
    material("Drywall", "sheet", 15),
    material("Flooring Material", "sf", 6),
  ]),
  home_construction: Object.freeze([
    labor("Site Superintendent", 75),
    labor("Excavation Crew", 60),
    labor("Foundation Crew", 60),
    labor("Framing Crew", 55),
    labor("Roofing Crew", 55),
    labor("Plumber", 65),
    labor("Electrician", 65),
    labor("HVAC Tech", 65),
    labor("Drywall Crew", 45),
    labor("Painter", 40),
    nonlabor("Excavator", 900),
    nonlabor("Dumpster / Waste Removal", 450),
    material("Concrete", "cy", 175),
    material("Lumber Package", "lot", 25000),
    material("Windows & Doors", "lot", 18000),
  ]),
  commercial_construction: Object.freeze([
    labor("Project Engineer", 95),
    labor("Structural Steel Erector Crew", 70),
    labor("Concrete Crew", 60),
    labor("Mechanical (HVAC) Crew", 65),
    labor("Electrical Crew", 65),
    labor("Plumbing Crew", 65),
    labor("Fire Protection Crew", 65),
    labor("Elevator Installer", 80),
    labor("Safety Officer", 55),
    nonlabor("Tower Crane", 2500),
    nonlabor("Man Lift", 400),
    material("Structural Steel", "ton", 2200),
    material("Curtain Wall / Facade", "sf", 65),
    material("MEP Equipment", "lot", 50000),
  ]),
});

export function starterResourceSetForTemplate(templateId) {
  return STARTER_RESOURCE_SETS[templateId] || STARTER_RESOURCE_SETS.standard;
}
