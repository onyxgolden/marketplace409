import { createMemoryPublisher, runJob } from "../src/runner.js";
import { SYNTHETIC_REPOSITORIES } from "../fixtures/repositories.js";

export const AS_OF = "2026-10-22T14:00:00.000Z";
export const fixedClock = (iso = "2026-10-22T13:55:00.000Z") => ({ nowIso: () => iso });

export const makeHost = (over = {}) => ({
  mode: "SYNTHETIC_PREVIEW",
  adapter_kind: "synthetic",
  registered_principal: "host:workbench-operator",
  registered_owner: "owner-a",
  registered_portfolio: "portfolio-a",
  ...over,
});

export const makeRequest = (over = {}) => ({
  principal_ref: "host:workbench-operator",
  owner_ref: "owner-a",
  portfolio_ref: "portfolio-a",
  job_kind: "property-manager-daily-exception-review",
  job_version: 1,
  as_of: AS_OF,
  window: { name: "lease-expiration-60d" },
  snapshot_request_id: "snap-test-1",
  ...over,
});

/** Host-owned adapter spec (data only): the execution worker builds the adapter from this. */
export const previewSpec = ({ datasets, faults = {} } = {}) => ({
  kind: "synthetic", datasets, faults,
});

export async function runPreview({ datasets, faults = {}, host = {}, request = {}, clock = fixedClock(), policies } = {}) {
  const data = datasets ?? SYNTHETIC_REPOSITORIES["preview-basic"]();
  const publisher = createMemoryPublisher();
  const result = await runJob({
    hostConfig: makeHost(host),
    request: makeRequest(request),
    adapterSpec: previewSpec({ datasets: data, faults }),
    publisher,
    clock,
    policies,
  });
  return { result, publisher };
}

export const onlyItem = (publisher) => {
  const items = [...publisher.items.values()];
  if (items.length !== 1) throw new Error(`expected exactly 1 published item, got ${items.length}`);
  return items[0];
};
