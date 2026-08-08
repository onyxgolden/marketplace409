"use client";

import {
  useState,
} from "react";

import {
  HVAC_COMPONENT_TYPES,
  HVAC_EVENT_ACTION_TYPES,
} from "@/domains/property-hvac/property-hvac.types";

const INPUT_CLASS =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold normal-case text-slate-950";

function displayValue(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function optionalText(value) {
  return String(value || "").trim() ||
    null;
}

export function buildHVACEventAction({
  values,
}) {
  return {
    actionType: values.actionType,
    componentId:
      optionalText(values.componentId),
    componentType:
      optionalText(
        values.componentType,
      ),
    description:
      String(
        values.description || "",
      ).trim(),
    quantity:
      values.quantity === ""
        ? null
        : Number(values.quantity),
    unit: optionalText(values.unit),
    allocatedCostCents:
      values
        .allocatedCostDollars === ""
        ? null
        : Math.round(
            Number(
              values
                .allocatedCostDollars,
            ) * 100,
          ),
  };
}

function Field({
  label,
  children,
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-slate-600">
      {label}
      {children}
    </label>
  );
}

export default function PropertyHVACEventActionEditor({
  components = [],
  actions = [],
  onChange = () => {},
}) {
  const [
    values,
    setValues,
  ] = useState({
    actionType: "repaired",
    componentId: "",
    componentType: "",
    description: "",
    quantity: "",
    unit: "",
    allocatedCostDollars: "",
  });

  const [
    message,
    setMessage,
  ] = useState("");

  function updateValue(
    name,
    value,
  ) {
    setValues((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function addAction() {
    const action =
      buildHVACEventAction({
        values,
      });

    if (!action.description) {
      setMessage(
        "Describe the component action.",
      );
      return;
    }

    onChange([
      ...actions,
      action,
    ]);

    setValues({
      actionType: "repaired",
      componentId: "",
      componentType: "",
      description: "",
      quantity: "",
      unit: "",
      allocatedCostDollars: "",
    });

    setMessage(
      "Component action added.",
    );
  }

  function removeAction(index) {
    onChange(
      actions.filter(
        (_action, actionIndex) =>
          actionIndex !== index,
      ),
    );
  }

  function actionIdentity(action) {
    if (action.componentId) {
      return (
        components.find(
          (component) =>
            component.id ===
            action.componentId,
        )?.name ||
        "Recorded component"
      );
    }

    if (action.componentType) {
      return displayValue(
        action.componentType,
      );
    }

    return "System action";
  }

  return (
    <section
      data-property-hvac-event-action-editor
      className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"
    >
      <div className="text-xs font-black uppercase tracking-wide text-amber-800">
        Component Actions
      </div>

      <h6 className="mt-2 text-base font-black text-slate-950">
        Work included in this event
      </h6>

      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
        Add every component replacement, repair, cleaning, recharge, inspection, or test covered by the same invoice total.
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Action type">
          <select
            value={values.actionType}
            onChange={(event) =>
              updateValue(
                "actionType",
                event.target.value,
              )
            }
            className={INPUT_CLASS}
          >
            {HVAC_EVENT_ACTION_TYPES.map(
              (value) => (
                <option
                  key={value}
                  value={value}
                >
                  {displayValue(value)}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label="Recorded component">
          <select
            value={values.componentId}
            onChange={(event) =>
              updateValue(
                "componentId",
                event.target.value,
              )
            }
            className={INPUT_CLASS}
          >
            <option value="">
              No existing component
            </option>

            {components.map(
              (component) => (
                <option
                  key={component.id}
                  value={component.id}
                >
                  {component.name}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label="Component type">
          <select
            value={
              values.componentType
            }
            onChange={(event) =>
              updateValue(
                "componentType",
                event.target.value,
              )
            }
            className={INPUT_CLASS}
          >
            <option value="">
              System or unspecified
            </option>

            {HVAC_COMPONENT_TYPES.map(
              (value) => (
                <option
                  key={value}
                  value={value}
                >
                  {displayValue(value)}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label="Action description">
          <input
            value={values.description}
            onChange={(event) =>
              updateValue(
                "description",
                event.target.value,
              )
            }
            placeholder="Replaced filter drier"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Quantity">
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.quantity}
            onChange={(event) =>
              updateValue(
                "quantity",
                event.target.value,
              )
            }
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Unit">
          <input
            value={values.unit}
            onChange={(event) =>
              updateValue(
                "unit",
                event.target.value,
              )
            }
            placeholder="each or pounds"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Allocated cost">
          <input
            type="number"
            min="0"
            step="0.01"
            value={
              values
                .allocatedCostDollars
            }
            onChange={(event) =>
              updateValue(
                "allocatedCostDollars",
                event.target.value,
              )
            }
            placeholder="Optional"
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={addAction}
        className="mt-4 rounded-xl bg-amber-700 px-4 py-3 text-sm font-black text-white"
      >
        Add component action
      </button>

      {message && (
        <p
          role="status"
          className="mt-3 text-sm font-bold text-slate-600"
        >
          {message}
        </p>
      )}

      {actions.length > 0 && (
        <div className="mt-5 space-y-3">
          <div className="text-sm font-black text-slate-950">
            Pending event actions
          </div>

          {actions.map(
            (action, index) => (
              <article
                key={`${action.actionType}-${action.description}-${index}`}
                className="flex items-start justify-between gap-4 rounded-xl border border-amber-200 bg-white p-4"
              >
                <div>
                  <div className="text-sm font-black text-slate-950">
                    {displayValue(
                      action.actionType,
                    )}
                    {" · "}
                    {actionIdentity(action)}
                  </div>

                  <div className="mt-1 text-sm font-semibold text-slate-600">
                    {action.description}
                  </div>

                  {(action.quantity != null ||
                    action.allocatedCostCents !=
                      null) && (
                    <div className="mt-2 text-xs font-bold text-slate-500">
                      {action.quantity != null
                        ? `${action.quantity} ${action.unit || ""}`.trim()
                        : ""}
                      {action.quantity != null &&
                      action.allocatedCostCents !=
                        null
                        ? " · "
                        : ""}
                      {action.allocatedCostCents !=
                      null
                        ? new Intl.NumberFormat(
                            "en-US",
                            {
                              style:
                                "currency",
                              currency:
                                "USD",
                            },
                          ).format(
                            action
                              .allocatedCostCents /
                              100,
                          )
                        : ""}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    removeAction(index)
                  }
                  className="text-xs font-black text-rose-700"
                >
                  Remove
                </button>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}
