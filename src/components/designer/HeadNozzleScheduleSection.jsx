import {
  endNozzleSide,
  endNozzleSpecs,
  headGeometry,
  headNozzleSchedule,
  headNozzleScheduleEntry,
  headNozzleScheduleProblems,
  headSurfaceOrientationDeg,
  isCurrentHeadNozzleInstance,
  isScheduledHeadVessel,
} from "@/domains/roomDesigner/vesselHeadNozzles";
import { previewHeadNozzleUpgrade } from "@/domains/roomDesigner/designerDocument";

/**
 * Inspector section for scheduled horizontal-vessel end-head nozzles
 * (D10-04, R4/O5): each end nozzle carries an authored schedule
 * entry — surface/head, top/bottom position, size, pressure-rating
 * status/value, elevation, tangent-line-to-flange projection. Values
 * are user-entered only — blank until someone types them; nothing
 * here invents a position, rating, elevation or projection. An entry
 * that fails validation reports its problems inline; an unscheduled
 * end nozzle reports NOZZLE_SCHEDULE_UNRESOLVED until its schedule
 * is authored.
 */
export default function HeadNozzleScheduleSection({ design, symbol, instance, dispatch }) {
  if (!isScheduledHeadVessel(symbol)) return null;
  const inst = instance;
  const inputClass =
    "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white placeholder:text-gray-600";
  const selectClass = "mt-1 block rounded bg-gray-800 px-2 py-1 text-white";

  // A pre-schedule vessel with no authored schedule yet: show the
  // legacy notice + explicit upgrade. A vessel carrying a schedule
  // (or a versioned one) shows the editor — the schedule is
  // authoritative even before the version is stamped.
  if (!isCurrentHeadNozzleInstance(inst) && !headNozzleSchedule(inst)) {
    const preview = previewHeadNozzleUpgrade(design);
    const mine = preview.instances.find((row) => row.instanceId === inst.id);
    const nozzleCount = mine ? mine.endNozzles.length : 0;
    const runCount = mine ? mine.attachedRunIds.length : 0;
    const unscheduled = mine ? mine.endNozzles.filter((e) => e.scheduledFace === null).length : 0;
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">Head nozzle schedule</h3>
        <p className="text-[11px] text-gray-500">
          This vessel predates the head-nozzle schedule model: its end-head nozzles still resolve
          to their prior side positions. Upgrading switches them to scheduled faces in one undoable
          step — {nozzleCount} end nozzle{nozzleCount === 1 ? "" : "s"} affected, {runCount} attached
          run{runCount === 1 ? "" : "s"}, {unscheduled} without a schedule yet (those endpoints
          keep their position and link, but the connection cannot verify until a schedule is
          authored).
        </p>
        <button
          onClick={() => dispatch({ type: "UPGRADE_HEAD_NOZZLES" })}
          className="w-full rounded bg-sky-700 px-2 py-1 text-xs text-white hover:bg-sky-600"
        >
          Upgrade head-nozzle schedules
        </button>
      </div>
    );
  }

  const ends = endNozzleSpecs(symbol, inst);
  if (ends.length === 0) return null;
  const schedule = headNozzleSchedule(inst) || [];
  const problems = headNozzleScheduleProblems(symbol, inst);
  const geo = headGeometry(symbol, inst);
  const setSchedule = (nextSchedule) =>
    dispatch({ type: "SET_HEAD_NOZZLE_SCHEDULE", instanceId: inst.id, schedule: nextSchedule });
  const patchEntry = (spec, patch) => {
    const entry = headNozzleScheduleEntry(inst, spec.id);
    const side = endNozzleSide(spec);
    const surface = side === "west" ? "head-west" : "head-east";
    const base = entry || {
      id: spec.id,
      sizeIn: spec.sizeIn,
      rating: { status: "unknown" },
      surface,
      position: "top",
      orientationDeg: headSurfaceOrientationDeg(surface),
    };
    const next = { ...base, ...patch };
    // Blank fields are absent, never zero — validation reports them
    // as missing instead of the editor inventing a value.
    for (const key of ["sizeIn", "elevationIn", "projectionIn"]) {
      if (next[key] === undefined) delete next[key];
    }
    if (next.rating?.status === "unknown") next.rating = { status: "unknown" };
    const nextSchedule = [...schedule.filter((e) => e?.id !== spec.id), next];
    setSchedule(nextSchedule);
  };
  const removeEntry = (spec) => {
    setSchedule(schedule.filter((e) => e?.id !== spec.id));
  };
  const entryProblems = (specId) =>
    problems.filter((p) => p.includes(`"${specId}"`));

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-300">
        Head nozzle schedule ({ends.length} end nozzle{ends.length === 1 ? "" : "s"})
      </h3>
      <p className="text-[11px] text-gray-500">
        Vessel centerline {Math.round(geo.centerlineIn)} in · head radius {Math.round(geo.radiusIn)} in ·
        tangent lines ±{Math.round(geo.shellLengthIn / 2)} in. End-head nozzles sit top or bottom
        on the vertical center plane — never the sides. Elevations are absolute (in); projections
        are measured from the tangent line.
      </p>
      {ends.map((spec) => {
        const entry = headNozzleScheduleEntry(inst, spec.id);
        const side = endNozzleSide(spec);
        const rows = entryProblems(spec.id);
        return (
          <div key={spec.id} className="rounded bg-gray-900/60 p-2">
            <div className="flex items-center justify-between text-xs font-semibold text-white">
              <span>
                {spec.id} · ⌀{spec.sizeIn}″ · {side === "west" ? "west" : "east"} head
              </span>
              {entry && (
                <button
                  onClick={() => removeEntry(spec)}
                  className="rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-gray-700"
                >
                  Remove schedule
                </button>
              )}
            </div>
            {!entry && (
              <p className="mt-1 text-[11px] text-amber-400">
                No scheduled head position (NOZZLE_SCHEDULE_UNRESOLVED) — fill in the schedule
                below.
              </p>
            )}
            <div className="mt-1 flex items-end gap-2">
              <label className="block flex-1 text-[11px] text-gray-400">
                Position
                <select
                  value={entry?.position || "top"}
                  onChange={(e) => patchEntry(spec, { position: e.target.value })}
                  className={selectClass}
                >
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label className="block flex-1 text-[11px] text-gray-400">
                Size (in)
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={entry?.sizeIn ?? ""}
                  placeholder="blank"
                  onChange={(e) =>
                    patchEntry(spec, {
                      sizeIn: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>
            <div className="mt-1 flex items-end gap-2">
              <label className="block flex-1 text-[11px] text-gray-400">
                Rating
                <select
                  value={entry?.rating?.status || "unknown"}
                  onChange={(e) =>
                    patchEntry(spec, {
                      rating:
                        e.target.value === "rated"
                          ? { status: "rated", value: entry?.rating?.value || "" }
                          : { status: "unknown" },
                    })
                  }
                  className={selectClass}
                >
                  <option value="unknown">Unknown</option>
                  <option value="rated">Rated</option>
                </select>
              </label>
              {entry?.rating?.status === "rated" && (
                <label className="block flex-1 text-[11px] text-gray-400">
                  Rating value
                  <input
                    type="text"
                    value={entry.rating.value ?? ""}
                    placeholder="e.g. 150"
                    onChange={(e) =>
                      patchEntry(spec, { rating: { status: "rated", value: e.target.value } })
                    }
                    className={inputClass}
                  />
                </label>
              )}
            </div>
            <div className="mt-1 flex items-end gap-2">
              <label className="block flex-1 text-[11px] text-gray-400">
                Elevation (in, absolute)
                <input
                  type="number"
                  step="any"
                  value={entry?.elevationIn ?? ""}
                  placeholder="blank"
                  onChange={(e) =>
                    patchEntry(spec, {
                      elevationIn: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block flex-1 text-[11px] text-gray-400">
                Projection (in, from tangent line)
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={entry?.projectionIn ?? ""}
                  placeholder="blank"
                  onChange={(e) =>
                    patchEntry(spec, {
                      projectionIn: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>
            {rows.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-400">
                {rows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-gray-500">
        Shell nozzles are separately typed and stay catalog-resolved — they are not scheduled
        here. The face normal is the axial outward direction of the named head.
      </p>
    </div>
  );
}
