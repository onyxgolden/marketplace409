// Column downcomer levels.
//
// A column carries tray levels at 10 ft intervals of its height
// (10 ft, 20 ft, 30 ft, ...). Each level is a DOWNCOMER level: its
// downcomer is the liquid passage carrying liquid down to the level
// below. Every downcomer level has:
//   - piping nozzles (D0b nozzle components) at the level's elevation —
//     including the DRAW OUTLET for the level's product — so a pipe run
//     connects at the level, at that elevation;
//   - an entry manway (D4 component) whose sill is the level elevation;
//   - platform access per the D5 rule: a steel grating catwalk at the
//     level with ladders climbing grade -> level -> level.
//
// The level count derives from the column's actual height, so resizing
// the column adds/removes levels by the same 10 ft rule. A level whose
// elevation equals the column height exactly is RETAINED (the 10/20/30
// ft example on a 30 ft column): its manway sill sits at the top tangent
// line and its platform at the top elevation — an authored planning
// convention, not a shell/head fit certification. Level identity is the
// elevation-derived index (level 2 is always the 20 ft level), so a
// resize preserves surviving levels' identities, attachments, and
// properties; properties for levels a shrink removes are preserved on
// the instance and flagged by validation, never silently discarded.
// The lowest level's downcomer passage terminates at the column sump /
// bottoms outlet — there is no tray below it. Datums stay distinct: a
// level's nozzle centerline sits AT the level elevation, and its manway
// SILL (the datum the access rule measures) is the level elevation too,
// with the platform deck at that sill.
// level is a product draw point, and the liquid drawn there has a
// temperature and a product. Those live on the instance as
//   downcomerProps: { [levelIndex]: { temperature?, product? } }
// They are DATA the user types (blank by default): nothing here invents
// a value or computes a temperature profile.
//
// Pure and framework-free.

import { findSymbol } from "./symbolRegistry";
import {
  accessPackageForManway,
  baseElevationIn,
  deckCorners,
  gradeElevationIn,
  localToWorld,
} from "./vesselAccess";

/** Vertical spacing of downcomer levels (in). */
export const DOWNCOMER_SPACING_IN = 120;
/** Manway diameter at each downcomer level (in). */
export const DOWNCOMER_MANWAY_DIAMETER_IN = 24;
/** Nominal size of a level's product draw outlet (in). */
export const DOWNCOMER_DRAW_SIZE_IN = 6;
/** Nominal size of a level's second piping nozzle (in). */
export const DOWNCOMER_NOZZLE_SIZE_IN = 8;
/** Dished-head depth ratio the 3D model draws on a tower-form vessel. */
export const HEAD_DISH_RATIO = 0.55;

/** True for catalog entries that carry downcomer levels (columns). */
export function isColumnSymbol(symbol) {
  return Boolean(symbol?.downcomers);
}

/** The column's height: instance override wins over the catalog nominal. */
export function columnHeightIn(symbol, inst) {
  return inst?.heightIn ?? symbol?.heightIn ?? 0;
}

/**
 * The MODELED head height (in) above a vertical vessel's shell — the
 * same geometry the 3D view draws (R4). An authored head
 * (`inst.headIn`, else `symbol.headIn`) is modeled geometry: the
 * descriptor carries it and the viewer renders it. Otherwise the
 * form decides: a slender vessel (height / diameter > 8) renders as
 * the stack form — shell and tip band only, NO head — while a
 * tower-form vessel renders a dished head of radius * HEAD_DISH_RATIO.
 * There is no default numeric allowance: a number that is not modeled
 * anywhere cannot prove a terminal assembly fits.
 */
export function modeledHeadHeightIn(symbol, inst) {
  if (!symbol || symbol.shape3d !== "vcyl") return 0;
  const authored = Number.isFinite(inst?.headIn)
    ? inst.headIn
    : Number.isFinite(symbol?.headIn)
      ? symbol.headIn
      : null;
  if (authored !== null) return authored;
  const w = inst?.widthIn ?? symbol.widthIn ?? 0;
  const d = inst?.depthIn ?? symbol.depthIn ?? 0;
  const r = Math.min(w, d) / 2;
  if (!(r > 0)) return 0;
  const h = inst?.heightIn ?? symbol?.heightIn ?? 0;
  if (h / (2 * r) > 8) return 0; // stack form: no head is modeled
  return r * HEAD_DISH_RATIO;
}

/**
 * The explicit usable-shell/head interval a column's downcomer levels
 * bind to (PR668-004): { minIn, maxIn, headAllowanceIn }. Levels live
 * in [minIn, maxIn]; the terminal level's complete manway assembly
 * (opening top = sill + diameter) must fit inside maxIn +
 * headAllowanceIn, where headAllowanceIn is the MODELED head height
 * (R4) — never a flat default.
 */
export function downcomerShellIntervalIn(symbol, inst) {
  const maxIn = columnHeightIn(symbol, inst);
  return { minIn: 0, maxIn, headAllowanceIn: modeledHeadHeightIn(symbol, inst) };
}

/**
 * validateDesign messages for downcomer geometry (PR668-004): every
 * level's elevation inside the usable shell, and the complete
 * terminal assembly (manway opening top) inside shell + head
 * allowance — otherwise a named out-of-bounds issue.
 */
export function downcomerGeometryErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    const symbol = findSymbol(inst.domain, inst.symbolId);
    if (!isColumnSymbol(symbol)) continue;
    if (inst?.legacyComponents === true) continue; // R8: not generated yet
    const { minIn, maxIn, headAllowanceIn } = downcomerShellIntervalIn(symbol, inst);
    for (const level of downcomerLevelSpecs(symbol, inst)) {
      const label = `Symbol ${inst.id} (${inst.tag || symbol.label}) downcomer level ${level.index}`;
      if (level.elevationIn < minIn - 1e-9 || level.elevationIn > maxIn + 1e-9) {
        errors.push(
          `${label} elevation ${level.elevationIn} in is out-of-bounds of the usable shell [${minIn}, ${maxIn}] in.`,
        );
      }
      const openingTop = level.manway.sillIn + level.manway.diameterIn;
      if (openingTop > maxIn + headAllowanceIn + 1e-9) {
        errors.push(
          `${label} manway assembly reaches ${openingTop} in, out-of-bounds past the shell top ${maxIn} in plus the ${headAllowanceIn} in modeled head.`,
        );
      }
    }
  }
  return errors;
}

const cleanText = (v) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
const cleanTemperature = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined; // undefined = invalid input
};
const cleanUnit = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const u = String(v).trim().toUpperCase();
  return u === "F" || u === "C" ? u : undefined;
};

/**
 * User-entered properties of one level:
 * { temperature: number|null, temperatureUnit: "F"|"C"|null, product: string }
 * Temperature is a nullable finite number with an explicit unit (zero is
 * a valid entered value); product is bounded free text. All blank/null
 * when the user has entered nothing — never defaulted or computed.
 */
export function downcomerLevelProps(inst, index) {
  const raw = inst?.downcomerProps?.[index];
  const temperature = cleanTemperature(raw?.temperature);
  return {
    temperature: temperature === undefined ? null : temperature,
    temperatureUnit: cleanUnit(raw?.temperatureUnit) || null,
    product: cleanText(raw?.product),
  };
}

/** Display label for a level: "Product · 350°F" with the parts that are set.
 * The unit rides only when the user chose one — a temperature entered
 * without a unit never defaults to F (D668-007). */
export function downcomerLabel(level) {
  const parts = [];
  if (level?.product) parts.push(level.product);
  if (level?.temperature !== null && level?.temperature !== undefined) {
    parts.push(
      level.temperatureUnit ? `${level.temperature}°${level.temperatureUnit}` : `${level.temperature}° (unit not set)`,
    );
  }
  return parts.join(" · ");
}

/**
 * Local-frame specs for a column's downcomer levels:
 * [{ index, elevationIn, nozzleSpecs: [{ id, fx, fy, sizeIn, elevationIn }],
 *    manway: { fx, fy, diameterIn, sillIn }, temperature, product }]
 * Draw outlets alternate sides down the column; the second nozzle sits
 * opposite. Manways face south (+fy) at every level so one access tower
 * serves them all.
 */
export function downcomerLevelSpecs(symbol, inst) {
  if (!isColumnSymbol(symbol)) return [];
  const heightIn = columnHeightIn(symbol, inst);
  const levels = [];
  for (let elevationIn = DOWNCOMER_SPACING_IN; elevationIn <= heightIn; elevationIn += DOWNCOMER_SPACING_IN) {
    const index = elevationIn / DOWNCOMER_SPACING_IN;
    const drawFx = index % 2 === 1 ? 1 : -1;
    const props = downcomerLevelProps(inst, index);
    levels.push({
      index,
      elevationIn,
      nozzleSpecs: [
        { id: `downcomer-${index}-draw`, fx: drawFx, fy: 0, sizeIn: DOWNCOMER_DRAW_SIZE_IN, elevationIn },
        { id: `downcomer-${index}-nozzle`, fx: -drawFx, fy: 0, sizeIn: DOWNCOMER_NOZZLE_SIZE_IN, elevationIn },
      ],
      manway: { fx: 0, fy: 1, diameterIn: DOWNCOMER_MANWAY_DIAMETER_IN, sillIn: elevationIn },
      temperature: props.temperature,
      temperatureUnit: props.temperatureUnit,
      product: props.product,
    });
  }
  return levels;
}

/** World plan position of a local (fx, fy) spec on an instance. */
function specWorld(symbol, inst, fx, fy) {
  const effWidth = inst?.widthIn ?? symbol.widthIn;
  const effDepth = inst?.depthIn ?? symbol.depthIn;
  return localToWorld(inst, fx * (effWidth / 2), fy * (effDepth / 2));
}

/**
 * A column's downcomer levels resolved to world coordinates:
 * [{ index, elevationIn, anchors: [{ id, x, y, sizeIn, elevationIn }],
 *    manway: { x, y, dirX, dirY, diameterIn, sillIn },
 *    platform: { deck, ladder } | null, temperature, product, label }]
 * The platform ladder climbs from the previous level (grade for the
 * first). Platforms follow the D5 rule via the shared access package;
 * the deck carries world-plan `corners` under the same geometry
 * contract as vessel decks (D668-001), and elevations are grade/base
 * aware (PR668-003): the D5 trigger reads the sill above grade, the
 * deck rides at the sill's world elevation.
 */
export function downcomerLevels(symbol, inst, design) {
  // Legacy gate (R8): a pre-marker instance has no generated levels
  // until the explicit retrofit.
  if (inst?.legacyComponents === true) return [];
  const specs = downcomerLevelSpecs(symbol, inst);
  const effWidth = inst?.widthIn ?? symbol?.widthIn ?? 0;
  const effDepth = inst?.depthIn ?? symbol?.depthIn ?? 0;
  const base = baseElevationIn(inst);
  const grade = gradeElevationIn(design);
  return specs.map((spec, i) => {
    // ONE world frame (R4): level elevation, anchor faces, and the
    // manway sill are all WORLD elevations (base + local spec) — the
    // same frame the platform deck already rode in, and the frame
    // pipe elevations and the shared face model speak.
    const anchors = spec.nozzleSpecs.map((n) => {
      const p = specWorld(symbol, inst, n.fx, n.fy);
      return { id: n.id, x: p.x, y: p.y, sizeIn: n.sizeIn, elevationIn: base + n.elevationIn };
    });
    const mp = specWorld(symbol, inst, spec.manway.fx, spec.manway.fy);
    const rad = ((inst?.rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const manwayLocal = {
      lx: spec.manway.fx * (effWidth / 2),
      ly: spec.manway.fy * (effDepth / 2),
      dirX: 0,
      dirY: 1,
      diameterIn: spec.manway.diameterIn,
      // D5 trigger datum: the sill ABOVE GRADE.
      sillIn: spec.elevationIn + base - grade,
    };
    const local_pkg = accessPackageForManway(manwayLocal, {
      fromIn: i === 0 ? grade : specs[i - 1].elevationIn + base,
      deckElevationIn: base + spec.elevationIn,
    });
    let platform = null;
    if (local_pkg) {
      const deckC = localToWorld(inst, local_pkg.deck.cx, local_pkg.deck.cy);
      const ladderC = localToWorld(inst, local_pkg.ladder.cx, local_pkg.ladder.cy);
      const deck = {
        ...local_pkg.deck,
        cx: deckC.x,
        cy: deckC.y,
        angleDeg: local_pkg.deck.angleDeg + (inst?.rotationDeg || 0),
      };
      platform = {
        deck: { ...deck, corners: deckCorners(deck) },
        ladder: {
          ...local_pkg.ladder,
          cx: ladderC.x,
          cy: ladderC.y,
          angleDeg: local_pkg.ladder.angleDeg + (inst?.rotationDeg || 0),
        },
      };
    }
    const level = {
      index: spec.index,
      elevationIn: base + spec.elevationIn,
      anchors,
      manway: {
        x: mp.x,
        y: mp.y,
        dirX: 0 * cos - 1 * sin,
        dirY: 0 * sin + 1 * cos,
        diameterIn: spec.manway.diameterIn,
        sillIn: base + spec.manway.sillIn,
      },
      platform,
      temperature: spec.temperature,
      temperatureUnit: spec.temperatureUnit,
      product: spec.product,
    };
    level.label = downcomerLabel(level);
    return level;
  });
}

/** World anchors of a column's downcomer nozzles (pipe connection points). */
export function downcomerAnchorsWorld(symbol, inst) {
  return downcomerLevels(symbol, inst).flatMap((level) => level.anchors);
}

/**
 * Set (or clear) a downcomer level's user-entered properties.
 * temperature: a finite number (zero is valid) or null/"" to clear;
 * temperatureUnit: "F" or "C" — or null/blank for UNKNOWN (D668-007:
 * a temperature entered without a unit never defaults to F; the unit
 * is user-entered, blank/default-unknown until chosen); product:
 * bounded text, blank clears. Clearing every field removes the entry;
 * an empty property map leaves the instance. Throws for an unknown
 * instance, a non-column, a level index the column's height does not
 * reach, or an invalid temperature/unit — entering data here never
 * touches another level or reorders levels.
 */
export function setDowncomerLevelProps(design, instanceId, index, props = {}) {
  const inst = (design?.symbols || []).find((s) => s.id === instanceId);
  if (!inst) throw new Error(`Unknown symbol instance: ${instanceId}`);
  const symbol = findSymbol(inst.domain, inst.symbolId);
  if (!isColumnSymbol(symbol)) throw new Error("Only a column has downcomer levels.");
  const levels = downcomerLevelSpecs(symbol, inst);
  if (!levels.some((l) => l.index === index)) {
    throw new Error(`Column ${instanceId} has no downcomer level ${index}.`);
  }
  const temperature = cleanTemperature(props.temperature);
  if (temperature === undefined) throw new Error("Downcomer temperature must be a finite number.");
  const unitGiven = cleanUnit(props.temperatureUnit);
  if (unitGiven === undefined) throw new Error('Downcomer temperature unit must be "F" or "C".');
  const temperatureUnit = temperature !== null ? unitGiven : null;
  const product = cleanText(props.product);
  const map = { ...(inst.downcomerProps || {}) };
  if (temperature === null && !product) delete map[index];
  else {
    map[index] = {
      ...(temperature !== null ? { temperature, temperatureUnit } : {}),
      ...(product ? { product } : {}),
    };
  }
  const symbols = design.symbols.map((s) => {
    if (s.id !== instanceId) return s;
    const next = { ...s };
    if (Object.keys(map).length > 0) next.downcomerProps = map;
    else delete next.downcomerProps;
    return next;
  });
  return { ...design, symbols };
}

/** validateDesign messages for instance downcomer properties. */
export function downcomerPropsErrors(design) {
  const errors = [];
  for (const inst of design?.symbols || []) {
    if (inst.downcomerProps === undefined) continue;
    const symbol = findSymbol(inst.domain, inst.symbolId);
    const map = inst.downcomerProps;
    const badShape =
      !map || typeof map !== "object" || Array.isArray(map) ||
      Object.entries(map).some(
        ([k, v]) =>
          !/^[1-9]\d*$/.test(k) || !v || typeof v !== "object" ||
          (v.temperature !== undefined && !Number.isFinite(v.temperature)) ||
          // D668-008: null unit means "not chosen yet" (valid); only F/C allowed if set.
          (v.temperatureUnit !== undefined && v.temperatureUnit !== null && v.temperatureUnit !== "F" && v.temperatureUnit !== "C") ||
          (v.product !== undefined && typeof v.product !== "string"),
      );
    if (badShape) {
      errors.push(`Symbol ${inst.id} has malformed downcomer properties.`);
      continue;
    }
    if (!isColumnSymbol(symbol)) {
      errors.push(`Symbol ${inst.id} has downcomer properties but is not a column.`);
      continue;
    }
    // Properties recorded for a level the column no longer reaches (it
    // was shrunk) are PRESERVED, never silently discarded — and flagged
    // here until the user restores the height or clears them.
    const reachable = new Set(downcomerLevelSpecs(symbol, inst).map((l) => String(l.index)));
    for (const key of Object.keys(map)) {
      if (!reachable.has(key)) {
        errors.push(
          `Symbol ${inst.id} (${inst.tag || symbol.label}) keeps downcomer properties for level ${key}, which its current height no longer reaches — the data is preserved, not deleted.`,
        );
      }
    }
  }
  return errors;
}
