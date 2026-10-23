import { downcomerLevels } from "@/domains/roomDesigner/downcomers";
import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";

/**
 * Inspector section for column downcomer levels (D6): every 10-ft tray
 * level is a product draw point carrying an editable temperature
 * (number + unit) and product. Values are user-entered only — blank
 * until someone types them; nothing here invents process data.
 */
export default function DowncomerSection({ symbol, instance, dispatch }) {
  const levels = downcomerLevels(symbol, instance);
  if (levels.length === 0) return null;
  const inputClass =
    "mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white placeholder:text-gray-600";
  const setProps = (level, patch) =>
    dispatch({
      type: "SET_DOWNCOMER_PROPS",
      instanceId: instance.id,
      index: level.index,
      props: {
        temperature: level.temperature,
        temperatureUnit: level.temperatureUnit,
        product: level.product,
        ...patch,
      },
    });
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-300">
        Downcomer levels ({levels.length})
      </h3>
      {levels.map((level) => (
        <div key={level.index} className="rounded bg-gray-900/60 p-2">
          <div className="text-xs font-semibold text-white">
            Downcomer {level.index} · {feetInchesLabel(level.elevationIn)}
          </div>
          <label className="block text-[11px] text-gray-400">
            Product draw
            <input
              type="text"
              value={level.product}
              placeholder="blank"
              onChange={(e) => setProps(level, { product: e.target.value })}
              className={inputClass}
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="block flex-1 text-[11px] text-gray-400">
              Temperature
              <input
                type="number"
                step="any"
                value={level.temperature ?? ""}
                placeholder="blank"
                onChange={(e) =>
                  setProps(level, {
                    temperature: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="block text-[11px] text-gray-400">
              Unit
              <select
                value={level.temperatureUnit}
                onChange={(e) => setProps(level, { temperatureUnit: e.target.value })}
                className="mt-1 block rounded bg-gray-800 px-2 py-1 text-white"
              >
                <option value="F">°F</option>
                <option value="C">°C</option>
              </select>
            </label>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-gray-500">
        Each level&apos;s nozzles include the draw outlet for its product. Temperatures and
        products are entered by hand — the designer never computes a temperature profile.
      </p>
    </div>
  );
}
