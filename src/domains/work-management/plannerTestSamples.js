// FORGE Planner owner-only test data — sample work-package manifest.
//
// The canonical definition of the six fictional sample packages the
// owner-only test-data loader creates (see
// forge_planner_test_load_samples in migration
// 20261117130000). The SQL loader embeds this same data as a literal
// VALUES list; the migration test proves the loader's output matches
// this manifest exactly (titles, step counts, sequence, craft, hours),
// so the two cannot drift silently.
//
// Fictional data only: a fictional FCCU unit at a fictional site. No
// real client, site, project, equipment tag, person, cost, or date.
// Packages are born linked to the validated test project (never
// Unassigned) and carry source_system 'forge_planner_test_seed_v1' so
// the loader is idempotent and the purge can identify them positively.

export const PLANNER_TEST_SAMPLE_SOURCE_SYSTEM = "forge_planner_test_seed_v1";

export const PLANNER_TEST_SAMPLE_PACKAGE_COUNT = 6;
export const PLANNER_TEST_SAMPLE_STEP_COUNT = 31;

export const PLANNER_TEST_SAMPLE_PACKAGES = Object.freeze([
  Object.freeze({
    ordinal: 1,
    title: "FCCU exchanger inspection [SAMPLE]",
    description:
      "Sample package: inspect a fictional FCCU exchanger (E-101) during a planned outage. Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Process",
    system: "Exchanger",
    equipmentTag: "E-101",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "Isolate and drain exchanger", description: "Isolate E-101 from process, drain and vent.", craftKey: "operations", craftLabel: "Operations", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Remove channel head and bundle", description: "Remove the channel head and pull the tube bundle.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 8, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 3, title: "Inspect tubes and tubesheet", description: "Visual inspection of tubes, tubesheet, and baffles.", craftKey: "inspection", craftLabel: "Inspection", plannedPersonHours: 6, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 4, title: "Eddy current test sample tubes", description: "Eddy current test a sample of tubes and record results.", craftKey: "inspection", craftLabel: "Inspection", plannedPersonHours: 8, plannedDurationDays: 2 }),
      Object.freeze({ sequence: 5, title: "Repair or plug defective tubes", description: "Plug or repair tubes found defective during inspection.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 6, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 6, title: "Reassemble and pressure test", description: "Reassemble the exchanger and pressure test before return to service.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 8, plannedDurationDays: 1 }),
    ]),
  }),
  Object.freeze({
    ordinal: 2,
    title: "Pump mechanical seal replacement [SAMPLE]",
    description:
      "Sample package: replace the mechanical seal on fictional pump P-201. Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Process",
    system: "Pumping",
    equipmentTag: "P-201",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "Isolate pump and lock out energy", description: "Isolate P-201, lock out electrical and process energy.", craftKey: "operations", craftLabel: "Operations", plannedPersonHours: 2, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Remove coupling and seal gland", description: "Remove the coupling and seal gland plate.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 3, title: "Inspect shaft sleeve and seal faces", description: "Inspect the shaft sleeve and seal faces for wear or scoring.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 3, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 4, title: "Install new seal and reassemble", description: "Install the new seal, reassemble the gland and coupling.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 6, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 5, title: "Align pump and return to service", description: "Align the pump, remove locks, and return to service.", craftKey: "mechanical", craftLabel: "Mechanical", plannedPersonHours: 4, plannedDurationDays: 1 }),
    ]),
  }),
  Object.freeze({
    ordinal: 3,
    title: "Valve replacement [SAMPLE]",
    description:
      "Sample package: replace a fictional block valve (V-301) in kind. Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Process",
    system: "Piping",
    equipmentTag: "V-301",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "Isolate line and drain section", description: "Isolate the line section around V-301 and drain it.", craftKey: "operations", craftLabel: "Operations", plannedPersonHours: 3, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Remove existing valve", description: "Unbolt and remove the existing valve.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 3, title: "Install replacement valve and gaskets", description: "Install the replacement valve with new gaskets and bolting.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 5, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 4, title: "Leak test and restore line", description: "Leak test the joints and restore the line to service.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 3, plannedDurationDays: 1 }),
    ]),
  }),
  Object.freeze({
    ordinal: 4,
    title: "Pipe spool fabrication and installation [SAMPLE]",
    description:
      "Sample package: fabricate and install a fictional pipe spool (L-401). Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Process",
    system: "Piping",
    equipmentTag: "L-401",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "Verify field measurements", description: "Verify field measurements against the spool drawing.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Cut and fit spool pieces", description: "Cut pipe to length and fit up the spool pieces.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 8, plannedDurationDays: 2 }),
      Object.freeze({ sequence: 3, title: "Weld spool joints", description: "Weld the spool joints to the approved procedure.", craftKey: "welding", craftLabel: "Welding", plannedPersonHours: 8, plannedDurationDays: 2 }),
      Object.freeze({ sequence: 4, title: "Inspect welds and test spool", description: "Inspect welds and pressure test the spool.", craftKey: "inspection", craftLabel: "Inspection", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 5, title: "Install spool and bolt flanges", description: "Set the spool in place and bolt up the flanges.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 6, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 6, title: "Flush line and leak test", description: "Flush the line and leak test before handover.", craftKey: "pipefitting", craftLabel: "Pipefitting", plannedPersonHours: 4, plannedDurationDays: 1 }),
    ]),
  }),
  Object.freeze({
    ordinal: 5,
    title: "Electrical MCC preventive maintenance [SAMPLE]",
    description:
      "Sample package: preventive maintenance on fictional motor control center MCC-2. Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Electrical",
    system: "Power distribution",
    equipmentTag: "MCC-2",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "De-energize MCC bucket and lock out", description: "De-energize the MCC bucket and apply locks and tags.", craftKey: "electrical", craftLabel: "Electrical", plannedPersonHours: 2, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Inspect bus bars and connections", description: "Inspect bus bars, stabs, and connections for heat or damage.", craftKey: "electrical", craftLabel: "Electrical", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 3, title: "Test breakers and overloads", description: "Function test breakers and overload relays.", craftKey: "electrical", craftLabel: "Electrical", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 4, title: "Clean and torque connections", description: "Clean the bucket and torque connections to spec.", craftKey: "electrical", craftLabel: "Electrical", plannedPersonHours: 3, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 5, title: "Re-energize and function test", description: "Remove locks, re-energize, and function test the bucket.", craftKey: "electrical", craftLabel: "Electrical", plannedPersonHours: 3, plannedDurationDays: 1 }),
    ]),
  }),
  Object.freeze({
    ordinal: 6,
    title: "Instrument loop checkout [SAMPLE]",
    description:
      "Sample package: checkout of fictional instrument loop LIC-501. Test data only.",
    packageType: "industrial",
    mode: "industrial",
    priority: "normal",
    unit: "FCCU",
    area: "Process",
    system: "Instrumentation",
    equipmentTag: "LIC-501",
    steps: Object.freeze([
      Object.freeze({ sequence: 1, title: "Verify loop drawings and setpoints", description: "Verify the loop drawing, setpoints, and alarm values.", craftKey: "instrumentation", craftLabel: "Instrumentation", plannedPersonHours: 2, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 2, title: "Calibrate transmitter", description: "Calibrate the loop transmitter and record as-found and as-left values.", craftKey: "instrumentation", craftLabel: "Instrumentation", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 3, title: "Check control valve stroke", description: "Stroke the control valve and check travel and seating.", craftKey: "instrumentation", craftLabel: "Instrumentation", plannedPersonHours: 3, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 4, title: "Loop test from field to control room", description: "Loop test the signal from the field device to the control room.", craftKey: "instrumentation", craftLabel: "Instrumentation", plannedPersonHours: 4, plannedDurationDays: 1 }),
      Object.freeze({ sequence: 5, title: "Document results and close loop", description: "Document the loop test results and close the loop checkout.", craftKey: "instrumentation", craftLabel: "Instrumentation", plannedPersonHours: 2, plannedDurationDays: 1 }),
    ]),
  }),
]);

/** Stable source_record_id for a sample package: seed + project + ordinal. */
export function plannerTestSamplePackageRecordId(projectId, ordinal) {
  return `${PLANNER_TEST_SAMPLE_SOURCE_SYSTEM}:${projectId}:pkg${ordinal}`;
}

/** Stable source_record_id for a sample step: seed + project + package ordinal + step sequence. */
export function plannerTestSampleStepRecordId(projectId, packageOrdinal, stepSequence) {
  return `${PLANNER_TEST_SAMPLE_SOURCE_SYSTEM}:${projectId}:pkg${packageOrdinal}:step${stepSequence}`;
}
