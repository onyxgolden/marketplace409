// TEMA shell-and-tube exchanger nomenclature for the FORGE designer.
//
// The three-letter designation (front head / shell / rear head, e.g. "AES")
// follows the public TEMA nomenclature: 5 front stationary heads, 7 shells,
// 8 rear heads — 20 component types. Names and descriptions below are
// FORGE's own plain-language summaries, not text copied from the TEMA
// Standards, and nothing here asserts TEMA certification or endorsement.
//
// Combination rules (TEMA_RULES) BLOCK only combinations that cannot be
// built as drawn and WARN on ones that are buildable but unusual; each rule
// carries its engineering basis so the list can be reviewed on its own.
//
// Pure and framework-free.

const type = (position, letter, name, description) => Object.freeze({ position, letter, name, description });

export const TEMA_FRONT_HEADS = Object.freeze([
  type("front", "A", "Channel and removable cover",
    "Flanged channel with a bolted flat cover; tubes can be reached without disturbing the tube-side piping."),
  type("front", "B", "Bonnet (integral cover)",
    "Dished bonnet flanged to the tubesheet; fewer joints, but piping must come off to open it."),
  type("front", "C", "Channel integral with tubesheet, removable cover (removable bundle)",
    "Channel welded to the tubesheet with a bolted cover; the tubesheet/channel assembly bolts to the shell flange so the bundle can be pulled."),
  type("front", "N", "Channel integral with tubesheet, removable cover (fixed to shell)",
    "Channel and shell are both welded to the tubesheet — no gasketed joint between shell and tube sides; bolted cover for tube access."),
  type("front", "D", "Special high-pressure closure",
    "Heavy forged channel barrel with an internal cover retained by a shear ring; used for very high tube-side pressure."),
]);

export const TEMA_SHELLS = Object.freeze([
  type("shell", "E", "One-pass shell",
    "Shell fluid enters at one end and leaves at the other across segmental baffles."),
  type("shell", "F", "Two-pass shell with longitudinal baffle",
    "A longitudinal baffle makes the shell fluid run down one half and back the other; both shell nozzles sit at the same end."),
  type("shell", "G", "Split flow",
    "Central inlet and outlet with a short longitudinal baffle that splits the shell flow in two."),
  type("shell", "H", "Double split flow",
    "Two longitudinal baffles and two sets of shell nozzles split the shell flow four ways; used for low pressure drop."),
  type("shell", "J", "Divided flow",
    "One central nozzle and two end nozzles divide the shell flow; low pressure drop for condensers and reboilers."),
  type("shell", "K", "Kettle-type reboiler",
    "Enlarged shell over an eccentric bundle leaves a vapor space; a weir holds the liquid level over the tubes."),
  type("shell", "X", "Cross flow",
    "Shell fluid crosses the bundle once from top to bottom; support plates only, very low pressure drop."),
]);

export const TEMA_REAR_HEADS = Object.freeze([
  type("rear", "L", "Fixed tubesheet, like stationary head A",
    "Fixed rear tubesheet with a flanged channel and removable flat cover."),
  type("rear", "M", "Fixed tubesheet, like stationary head B",
    "Fixed rear tubesheet with a dished bonnet."),
  type("rear", "N", "Fixed tubesheet, like stationary head N",
    "Fixed rear tubesheet welded to shell and channel, with a removable cover."),
  type("rear", "P", "Outside packed floating head",
    "Floating tubesheet extends through a packing gland at the shell end; the floating head cover sits outside the shell."),
  type("rear", "S", "Floating head with backing device",
    "Floating head cover bolted to a split backing ring behind the floating tubesheet, enclosed by a larger shell cover."),
  type("rear", "T", "Pull-through floating head",
    "Floating head cover bolted directly to the floating tubesheet so the bundle pulls through the shell; larger bundle-to-shell clearance."),
  type("rear", "U", "U-tube bundle",
    "Tubes bent into U's return to the stationary tubesheet; no rear tubesheet, dished shell cover."),
  type("rear", "W", "Externally sealed floating tubesheet",
    "Floating tubesheet sealed by two packing rings separated by a lantern ring with leak-off; low pressure, non-hazardous service."),
]);

/** Supported tube-pass counts for the drawing and the picker. */
export const TEMA_TUBE_PASSES = Object.freeze([1, 2, 4, 6, 8]);

const cfg = (front, shell, rear, tubePasses) => Object.freeze({ front, shell, rear, tubePasses });

/** Quick presets offered by the picker (owner decision: AES, BEM, BEU, AET). */
export const TEMA_PRESETS = Object.freeze({
  AES: cfg("A", "E", "S", 2),
  BEM: cfg("B", "E", "M", 1),
  BEU: cfg("B", "E", "U", 2),
  AET: cfg("A", "E", "T", 2),
});

const FRONT_LETTERS = TEMA_FRONT_HEADS.map((t) => t.letter);
const SHELL_LETTERS = TEMA_SHELLS.map((t) => t.letter);
const REAR_LETTERS = TEMA_REAR_HEADS.map((t) => t.letter);

export function temaFrontHead(letter) {
  return TEMA_FRONT_HEADS.find((t) => t.letter === letter);
}
export function temaShell(letter) {
  return TEMA_SHELLS.find((t) => t.letter === letter);
}
export function temaRearHead(letter) {
  return TEMA_REAR_HEADS.find((t) => t.letter === letter);
}

/**
 * Loose input -> { front, shell, rear, tubePasses } with upper-case letters
 * and a numeric pass count (default 2). Returns null for non-objects. Does
 * NOT validate the letters — validateTemaConfig does.
 */
export function normalizeTemaConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const letter = (v) => (typeof v === "string" ? v.trim().toUpperCase() : "");
  const passes = input.tubePasses === undefined || input.tubePasses === null || input.tubePasses === ""
    ? 2
    : Number(input.tubePasses);
  return {
    front: letter(input.front),
    shell: letter(input.shell),
    rear: letter(input.rear),
    tubePasses: passes,
  };
}

/** "AES" for { front: "A", shell: "E", rear: "S" }. */
export function temaDesignation(config) {
  return `${config?.front || "?"}${config?.shell || "?"}${config?.rear || "?"}`;
}

/** "AES" -> config with 2 tube passes; null unless every letter fits its position. */
export function parseTemaDesignation(code) {
  if (typeof code !== "string") return null;
  const m = /^([A-Z])([A-Z])([A-Z])$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  if (!FRONT_LETTERS.includes(m[1]) || !SHELL_LETTERS.includes(m[2]) || !REAR_LETTERS.includes(m[3])) return null;
  return { front: m[1], shell: m[2], rear: m[3], tubePasses: 2 };
}

const FIXED_REARS = ["L", "M", "N"];
const FLOATING_OR_U_REARS = ["P", "S", "T", "U", "W"];
const PACKED_REARS = ["P", "W"];

const rule = (id, severity, summary, basis, applies) => Object.freeze({ id, severity, summary, basis, applies });

/**
 * Every combination rule, in evaluation order. `applies(config)` is true when
 * the rule fires. "block" rules make the configuration invalid; "warn" rules
 * only annotate it.
 */
export const TEMA_RULES = Object.freeze([
  rule("front-letter", "block", "Front head must be one of A, B, C, N, D.",
    "TEMA nomenclature defines exactly five front-end stationary head types.",
    (c) => !FRONT_LETTERS.includes(c.front)),
  rule("shell-letter", "block", "Shell must be one of E, F, G, H, J, K, X.",
    "TEMA nomenclature defines exactly seven shell types.",
    (c) => !SHELL_LETTERS.includes(c.shell)),
  rule("rear-letter", "block", "Rear head must be one of L, M, N, P, S, T, U, W.",
    "TEMA nomenclature defines exactly eight rear-end head types.",
    (c) => !REAR_LETTERS.includes(c.rear)),
  rule("tube-passes", "block", `Tube passes must be one of ${TEMA_TUBE_PASSES.join(", ")}.`,
    "The drawing supports single-pass and even multi-pass arrangements only; other counts are not drawn.",
    (c) => !TEMA_TUBE_PASSES.includes(c.tubePasses)),
  rule("u-tube-even-passes", "block", "A U-tube bundle (rear head U) needs an even number of tube passes.",
    "Every U-tube leaves and returns to the same stationary tubesheet, so each tube makes two passes; a single-pass U-tube exchanger cannot be built.",
    (c) => c.rear === "U" && c.tubePasses % 2 === 1),
  rule("floating-head-single-pass", "warn", "Single tube pass with an S or T floating head is unusual.",
    "The tube outlet must pass through the shell cover to the moving floating head, which needs an internal packed joint or bellows; most S/T units use 2+ passes.",
    (c) => (c.rear === "S" || c.rear === "T") && c.tubePasses === 1),
  rule("c-front-fixed-rear", "warn", "C front head with a fixed-tubesheet rear (L/M/N) is unusual.",
    "The C head exists so the bundle can be removed; with a fixed rear tubesheet it cannot be, and an N front is the usual choice.",
    (c) => c.front === "C" && FIXED_REARS.includes(c.rear)),
  rule("n-front-removable-rear", "warn", "N front head with a removable-bundle rear (P/S/T/U/W) is unusual.",
    "An N head welds the front tubesheet to the shell, so the bundle cannot be pulled and the floating/U-tube rear loses its main purpose.",
    (c) => c.front === "N" && FLOATING_OR_U_REARS.includes(c.rear)),
  rule("kettle-fixed-tubesheet", "warn", "Kettle shell (K) with a fixed-tubesheet rear (L/M/N) is unusual.",
    "Kettle reboilers are normally built with removable U-tube or pull-through floating-head bundles (e.g. BKU, AKT) for cleaning and expansion.",
    (c) => c.shell === "K" && FIXED_REARS.includes(c.rear)),
  rule("kettle-packed-rear", "warn", "Kettle shell (K) with a packed rear head (P/W) is unusual.",
    "Packed joints are for low-pressure, non-hazardous service and are rarely paired with boiling hydrocarbons in a kettle.",
    (c) => c.shell === "K" && PACKED_REARS.includes(c.rear)),
  rule("packed-rear-high-pressure-front", "warn", "D (high-pressure) front head with a packed rear head (P/W) is inconsistent.",
    "A D closure implies very high tube-side pressure, while P and W packed joints are low-pressure designs.",
    (c) => c.front === "D" && PACKED_REARS.includes(c.rear)),
  rule("f-shell-single-pass", "warn", "F shell with a single tube pass is unusual.",
    "The F shell's two shell passes are normally matched with two (or more) tube passes for counter-current flow.",
    (c) => c.shell === "F" && c.tubePasses === 1),
  rule("w-rear-multipass", "warn", "W rear head with more than two tube passes is unusual.",
    "The externally sealed floating tubesheet is commonly limited to one or two tube passes (verify against the TEMA edition in use).",
    (c) => c.rear === "W" && c.tubePasses > 2),
]);

/**
 * Validate a configuration: { valid, errors: [{ rule, message, basis }],
 * warnings: [...] }. Never throws.
 */
export function validateTemaConfig(config) {
  const c = normalizeTemaConfig(config);
  if (!c) {
    return {
      valid: false,
      errors: [{ rule: "config", message: "TEMA configuration is missing.", basis: "A front head, shell and rear head are required." }],
      warnings: [],
    };
  }
  const errors = [];
  const warnings = [];
  for (const r of TEMA_RULES) {
    if (!r.applies(c)) continue;
    const entry = { rule: r.id, message: r.summary, basis: r.basis };
    (r.severity === "block" ? errors : warnings).push(entry);
  }
  return { valid: errors.length === 0, errors, warnings };
}
