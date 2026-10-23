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
import { accessPackageForManway, localToWorld } from "./vesselAccess";

/** Vertical spacing of downcomer levels (in). */
export const DOWNCOMER_SPACING_IN = 120;
/** Manway diameter at each downcomer level (in). */
export const DOWNCOMER_MANWAY_DIAMETER_IN = 24;
/** Nominal size of a level's product draw outlet (in). */
export const DOWNCOMER_DRAW_SIZE_IN = 6;
/** Nominal size of a level's second piping nozzle (in). */
export const DOWNCOMER_NOZZLE_SIZE_IN = 8;

/** True for catalog entries that carry downcomer levels (columns). */
export function isColumnSymbol(symbol) {
  return Boolean(symbol?.downcomers);
}

/** The column's height: instance override wins over the catalog nominal. */
export function columnHeightIn(symbol, inst) {
  return inst?.heightIn ?? symbol?.heightIn ?? 0;
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

/** Display label for a level: "Product · 350°F" with the parts that are set. */
export function downcomerLabel(level) {
  const parts = [];
  if (level?.product) parts.push(level.product);
  if (level?.temperature !== null && level?.temperature !== undefined) {
    parts.push(`${level.temperature}°${level.temperatureUnit || "F"}`);
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
 * first). Platforms follow the D5 rule via the shared access package.
 */
export function downcomerLevels(symbol, inst) {
  const specs = downcomerLevelSpecs(symbol, inst);
  const effWidth = inst?.widthIn ?? symbol?.widthIn ?? 0;
  const effDepth = inst?.depthIn ?? symbol?.depthIn ?? 0;
  return specs.map((spec, i) => {
    const anchors = spec.nozzleSpecs.map((n) => {
      const p = specWorld(symbol, inst, n.fx, n.fy);
      return { id: n.id, x: p.x, y: p.y, sizeIn: n.sizeIn, elevationIn: n.elevationIn };
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
      sillIn: spec.manway.sillIn,
    };
    const local_pkg = accessPackageForManway(manwayLocal, {
      fromIn: i === 0 ? 0 : specs[i - 1].elevationIn,
    });
    let platform = null;
    if (local_pkg) {
      const deckC = localToWorld(inst, local_pkg.deck.cx, local_pkg.deck.cy);
      const ladderC = localToWorld(inst, local_pkg.ladder.cx, local_pkg.ladder.cy);
      platform = {
        deck: { ...local_pkg.deck, cx: deckC.x, cy: deckC.y, angleDeg: local_pkg.deck.angleDeg + (inst?.rotationDeg || 0) },
        ladder: { ...local_pkg.ladder, cx: ladderC.x, cy: ladderC.y, angleDeg: local_pkg.ladder.angleDeg + (inst?.rotationDeg || 0) },
      };
    }
    const level = {
      index: spec.index,
      elevationIn: spec.elevationIn,
      anchors,
      manway: {
        x: mp.x,
        y: mp.y,
        dirX: 0 * cos - 1 * sin,
        dirY: 0 * sin + 1 * cos,
        diameterIn: spec.manway.diameterIn,
        sillIn: spec.manway.sillIn,
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
 * temperatureUnit: "F" or "C" (defaults to "F" when a temperature is
 * set without one); product: bounded text, blank clears. Clearing every
 * field removes the entry; an empty property map leaves the instance.
 * Throws for an unknown instance, a non-column, a level index the
 * column's height does not reach, or an invalid temperature/unit —
 * entering data here never touches another level or reorders levels.
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
  const temperatureUnit = temperature !== null ? unitGiven || "F" : null;
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
          (v.temperatureUnit !== undefined && v.temperatureUnit !== "F" && v.temperatureUnit !== "C") ||
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
