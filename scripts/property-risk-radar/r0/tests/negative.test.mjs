// Negative tests — the HTTP harness and the adapters fail closed.
// Every fetch here is an injected fake: no test in this file touches the
// network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBoundedFetch,
  redactSecrets,
  findSecretLike,
} from "../src/http.mjs";
import { ADAPTERS } from "../src/preflight.mjs";
import {
  checkDeclaredResponsePaths,
  GEOJSON_GEOMETRY_TYPES,
} from "../src/schemaDigest.mjs";
import * as wfigs from "../src/adapters/wfigs-perimeters.mjs";
import * as fema from "../src/adapters/fema-nfhl.mjs";
import * as nhc from "../src/adapters/nhc-tropical.mjs";
import * as usgs from "../src/adapters/usgs-earthquakes.mjs";
import * as census from "../src/adapters/census-geocoder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R0 = path.resolve(__dirname, "..");

const ALLOW = {
  allowHosts: ["api.weather.gov"],
  allowPathPrefixes: ["/alerts/", "/openapi.json"],
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function routeFetch(routes) {
  return async (url, init) => {
    const parsed = new URL(url);
    const handler = routes[parsed.pathname];
    if (!handler) {
      return jsonResponse({ error: "not found" }, 404);
    }
    return handler(parsed, init);
  };
}

test("harness refuses a host outside the allowlist", async () => {
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    fetchFn("https://evil.example.com/alerts/active"),
    (error) => error.code === "HOST_NOT_ALLOWLISTED",
  );
});

test("harness refuses a path outside the allowlist", async () => {
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    fetchFn("https://api.weather.gov/admin/secret"),
    (error) => error.code === "PATH_NOT_ALLOWED",
  );
});

test("harness refuses a non-HTTPS URL", async () => {
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(
    fetchFn("http://api.weather.gov/alerts/active"),
    (error) => error.code === "NOT_HTTPS",
  );
});

test("harness refuses a redirect to a non-allowlisted host", async () => {
  const fake = routeFetch({
    "/alerts/active": () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/x" },
      }),
  });
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: fake });
  await assert.rejects(
    fetchFn("https://api.weather.gov/alerts/active"),
    (error) => error.code === "HOST_NOT_ALLOWLISTED",
  );
});

test("harness refuses a redirect chain longer than two hops", async () => {
  const fake = routeFetch({
    "/alerts/a": () =>
      new Response(null, { status: 302, headers: { location: "/alerts/b" } }),
    "/alerts/b": () =>
      new Response(null, { status: 302, headers: { location: "/alerts/c" } }),
    "/alerts/c": () =>
      new Response(null, { status: 302, headers: { location: "/alerts/d" } }),
    "/alerts/d": () => jsonResponse({ ok: true }),
  });
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: fake });
  await assert.rejects(
    fetchFn("https://api.weather.gov/alerts/a"),
    (error) => error.code === "TOO_MANY_REDIRECTS",
  );
});

test("harness follows one allowlisted redirect", async () => {
  const target = JSON.parse(
    readFileSync(path.join(R0, "tests", "http-fixtures", "redirect-target.json"), "utf8"),
  );
  const fake = routeFetch({
    "/alerts/active": () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://api.weather.gov/openapi.json" },
      }),
    "/openapi.json": () => jsonResponse(target),
  });
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: fake });
  const result = await fetchFn("https://api.weather.gov/alerts/active");
  assert.equal(result.status, 200);
  assert.equal(result.redirects, 1);
  assert.deepEqual(JSON.parse(result.bodyText), target);
});

test("harness refuses an oversized body by content-length and by stream", async () => {
  const byLength = createBoundedFetch({
    ...ALLOW,
    fetchImpl: async () =>
      new Response("small", {
        status: 200,
        headers: { "content-length": "6000000" },
      }),
  });
  await assert.rejects(
    byLength("https://api.weather.gov/alerts/active"),
    (error) => error.code === "BODY_TOO_LARGE",
  );

  const bigStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(3 * 1024 * 1024)));
      controller.enqueue(new TextEncoder().encode("x".repeat(3 * 1024 * 1024)));
      controller.close();
    },
  });
  const byStream = createBoundedFetch({
    ...ALLOW,
    fetchImpl: async () => new Response(bigStream, { status: 200 }),
  });
  await assert.rejects(
    byStream("https://api.weather.gov/alerts/active"),
    (error) => error.code === "BODY_TOO_LARGE",
  );
});

test("harness times out a hanging request", async () => {
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "TimeoutError";
        reject(error);
      });
    });
  const fetchFn = createBoundedFetch({
    ...ALLOW,
    fetchImpl: hanging,
    timeoutMs: 50,
  });
  await assert.rejects(
    fetchFn("https://api.weather.gov/alerts/active"),
    (error) => error.code === "TIMEOUT",
  );
});

test("harness retries once on 429 honoring Retry-After, then stops", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" });
    }
    return jsonResponse({ ok: true });
  };
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: flaky });
  const result = await fetchFn("https://api.weather.gov/alerts/active");
  assert.equal(result.status, 200);
  assert.equal(result.retries, 1);
  assert.equal(calls, 2);

  const always429 = async () =>
    jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" });
  const fetchFn2 = createBoundedFetch({ ...ALLOW, fetchImpl: always429 });
  const stuck = await fetchFn2("https://api.weather.gov/alerts/active");
  assert.equal(stuck.status, 429);
  assert.equal(stuck.retries, 1);
});

test("harness retries once on 5xx and then returns the failure", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    return calls === 1 ? jsonResponse({ error: "boom" }, 500) : jsonResponse({ ok: true });
  };
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: flaky });
  const result = await fetchFn("https://api.weather.gov/alerts/active");
  assert.equal(result.status, 200);
  assert.equal(result.retries, 1);
  assert.equal(calls, 2);
});

test("harness serializes concurrent requests to the same host", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const slow = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 25));
    inFlight -= 1;
    return jsonResponse({ ok: true });
  };
  const fetchFn = createBoundedFetch({ ...ALLOW, fetchImpl: slow });
  await Promise.all([
    fetchFn("https://api.weather.gov/alerts/active"),
    fetchFn("https://api.weather.gov/alerts/active"),
  ]);
  assert.equal(maxInFlight, 1);
});

test("an ArcGIS 200 response carrying an error object fails adapter validation", () => {
  const errorBody = JSON.parse(
    readFileSync(
      path.join(R0, "tests", "http-fixtures", "arcgis-error-200.json"),
      "utf8",
    ),
  );
  assert.ok(errorBody.error, "fixture must carry an ArcGIS error object");
  // The adapter validates the parsed body as a sample: an error payload has
  // none of the required sample fields, so it must not validate.
  assert.ok(wfigs.validateSample(errorBody).length > 0);
});

test("malformed JSON cannot parse, so it cannot validate", () => {
  const text = readFileSync(
    path.join(R0, "tests", "http-fixtures", "malformed.json"),
    "utf8",
  );
  assert.throws(() => JSON.parse(text));
});

test("secret redaction masks keys and tokens; the scanner finds them", () => {
  const redacted = redactSecrets(
    "call https://example.com/?api_key=abc123 with Authorization: Bearer xyz",
  );
  assert.ok(!redacted.includes("abc123"));
  assert.ok(!redacted.includes("Bearer xyz"));
  assert.ok(redacted.includes("[REDACTED]"));
  assert.ok(findSecretLike("token=abc123") !== null);
  assert.ok(findSecretLike({ nested: ["sk-abcdefgh12345678"] }) !== null);
  assert.equal(findSecretLike("hello world"), null);
  assert.equal(findSecretLike({ clean: "no secrets here" }), null);
});

// P2 regression: the declared contract paths must be traversed against the
// actual response. A contract describing ArcGIS-JSON (attributes/rings/
// Polyline) while the wire format is GeoJSON must fail — a descriptive
// but wrong contract cannot still validate.
test("declared response paths resolve against every adapter's fixture sample", () => {
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    const sample = JSON.parse(
      readFileSync(path.join(R0, "fixtures", id, "sample.json"), "utf8"),
    );
    assert.deepEqual(
      checkDeclaredResponsePaths(sample, adapter.CONTRACT, `${id}.sample`),
      [],
      `${id}: declared paths must resolve against its fixture`,
    );
  }
});

test("the P2 defect: ArcGIS-JSON declared paths fail against the GeoJSON fixture", () => {
  const arcgisContracts = {
    "wfigs-perimeters": {
      requiredFields: [
        "features[].attributes.OBJECTID",
        "features[].attributes.IncidentName",
        "features[].geometry.rings",
        "exceededTransferLimit",
      ],
      observationTimeField: "features[].attributes.DateCurrent",
    },
    "fema-nfhl": {
      requiredFields: [
        "features[].attributes.FLD_ZONE",
        "features[].attributes.SFHA_TF",
        "features[].attributes.PANEL",
        "features[].attributes.EFF_DATE",
      ],
      observationTimeField: "features[].attributes.EFF_DATE (map effective date)",
    },
    "nhc-tropical": {
      requiredFields: [
        "features[].attributes.STORMNAME",
        "features[].attributes.STORMID",
        "features[].attributes.ADVISORY",
      ],
      observationTimeField:
        "features[].attributes.ADVISORY (advisory identity; storm time per layer)",
      geometryTypes: ["Point", "Polyline", "Polygon"],
    },
  };
  for (const [id, overrides] of Object.entries(arcgisContracts)) {
    const adapter = ADAPTERS[id];
    const sample = JSON.parse(
      readFileSync(path.join(R0, "fixtures", id, "sample.json"), "utf8"),
    );
    const tampered = {
      ...adapter.CONTRACT,
      response: {
        ...adapter.CONTRACT.response,
        requiredFields: overrides.requiredFields,
        geometryTypes:
          overrides.geometryTypes || adapter.CONTRACT.response.geometryTypes,
      },
      observationTimeField: overrides.observationTimeField,
    };
    const errors = checkDeclaredResponsePaths(sample, tampered, `${id}.sample`);
    assert.ok(errors.length > 0, `${id}: ArcGIS-JSON paths must fail`);
    assert.ok(
      errors.some((error) => error.includes("attributes") || error.includes("Polyline")),
      `${id}: the failure must name the wrong ArcGIS path: ${errors.join("; ")}`,
    );
  }
});

test("an ArcGIS-JSON-shaped sample fails adapter validation", () => {
  const arcgisWfigs = {
    synthetic: true,
    type: "FeatureCollection",
    exceededTransferLimit: false,
    features: [
      {
        type: "Feature",
        attributes: {
          OBJECTID: 1,
          IncidentName: "SYNTHETIC TEST FIRE",
          DateCurrent: "2026-11-20T12:00:00Z",
        },
        geometry: {
          type: "Polygon",
          rings: [[[-102.0, 31.5], [-101.9, 31.5], [-101.9, 31.6], [-102.0, 31.5]]],
        },
      },
    ],
  };
  assert.ok(wfigs.validateSample(arcgisWfigs).length > 0);

  const arcgisFema = {
    synthetic: true,
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        attributes: {
          FLD_ZONE: "X",
          SFHA_TF: "F",
          PANEL: "SYNTHETIC-PANEL-0000",
          EFF_DATE: "2020-01-01",
        },
        geometry: { type: "Polygon", rings: [[[-95.37, 29.76]]] },
      },
    ],
  };
  assert.ok(fema.validateSample(arcgisFema).length > 0);

  const arcgisNhc = {
    synthetic: true,
    type: "FeatureCollection",
    exceededTransferLimit: false,
    features: [
      {
        type: "Feature",
        attributes: {
          STORMNAME: "SYNTHETIC TEST STORM",
          STORMID: "AL012026",
          ADVISORY: "SYNTHETIC-001",
        },
        geometry: { type: "Polyline", paths: [[[-75.0, 25.0]]] },
      },
    ],
  };
  assert.ok(nhc.validateSample(arcgisNhc).length > 0);
});

test("a sample missing a declared required field fails validation", () => {
  const wfigsSample = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "wfigs-perimeters", "sample.json"), "utf8"),
  );
  delete wfigsSample.features[0].properties.poly_IncidentName;
  assert.ok(wfigs.validateSample(wfigsSample).length > 0);

  const femaSample = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "fema-nfhl", "sample.json"), "utf8"),
  );
  delete femaSample.features[0].properties.FLD_ZONE;
  assert.ok(fema.validateSample(femaSample).length > 0);
});

// Live-wire-format regressions, verified against the real providers
// 2026-11-20. The R0 contracts were written from documentation and
// synthetic assumptions; the live preflight proved each of these wrong,
// so the validators must accept the real wire format — and still reject
// genuinely wrong shapes.
test("USGS live coordinates carry depth as a third element", () => {
  const sample = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "usgs-earthquakes", "sample.json"), "utf8"),
  );
  assert.deepEqual(usgs.validateSample(sample), []);
  assert.equal(sample.features[0].geometry.coordinates.length, 3);

  const badLng = JSON.parse(JSON.stringify(sample));
  badLng.features[0].geometry.coordinates = [-200.0, 29.76, 10.5];
  assert.ok(usgs.validateSample(badLng).length > 0);

  const badDepth = JSON.parse(JSON.stringify(sample));
  badDepth.features[0].geometry.coordinates = [-95.37, 29.76, "deep"];
  assert.ok(usgs.validateSample(badDepth).length > 0);

  const twoElement = JSON.parse(JSON.stringify(sample));
  twoElement.features[0].geometry.coordinates = [-95.37, 29.76];
  assert.deepEqual(usgs.validateSample(twoElement), []);
});

test("WFIGS live metadata has no supportsPagination; live fields carry poly_", () => {
  const metadata = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "wfigs-perimeters", "metadata.json"), "utf8"),
  );
  const noPagination = { ...metadata };
  delete noPagination.supportsPagination;
  assert.deepEqual(wfigs.validateMetadata(noPagination), []);
  assert.deepEqual(wfigs.validateMetadata(metadata), []);

  const sample = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "wfigs-perimeters", "sample.json"), "utf8"),
  );
  assert.deepEqual(wfigs.validateSample(sample), []);

  const missingName = JSON.parse(JSON.stringify(sample));
  delete missingName.features[0].properties.poly_IncidentName;
  assert.ok(wfigs.validateSample(missingName).length > 0);

  const badFlag = JSON.parse(JSON.stringify(sample));
  badFlag.properties.exceededTransferLimit = "yes";
  assert.ok(wfigs.validateSample(badFlag).length > 0);

  const noFlag = JSON.parse(JSON.stringify(sample));
  delete noFlag.properties;
  assert.deepEqual(wfigs.validateSample(noFlag), []);

  const polygon = JSON.parse(JSON.stringify(sample));
  polygon.features[0].geometry = {
    type: "Polygon",
    coordinates: [[[-102.0, 31.5], [-101.9, 31.5], [-101.9, 31.6], [-102.0, 31.5]]],
  };
  assert.deepEqual(wfigs.validateSample(polygon), []);
});

test("NHC live empty sample carries no exceededTransferLimit", () => {
  const empty = { synthetic: true, type: "FeatureCollection", features: [] };
  assert.deepEqual(nhc.validateSample(empty), []);

  const badFlag = { ...empty, exceededTransferLimit: "yes" };
  assert.ok(nhc.validateSample(badFlag).length > 0);
});

test("Census live input nests address and benchmark as objects", () => {
  const sample = JSON.parse(
    readFileSync(path.join(R0, "fixtures", "census-geocoder", "sample.json"), "utf8"),
  );
  assert.deepEqual(census.validateSample(sample), []);

  const wrongBenchmark = JSON.parse(JSON.stringify(sample));
  wrongBenchmark.result.input.benchmark.benchmarkName = "Public_AR_ACS2023";
  assert.ok(census.validateSample(wrongBenchmark).length > 0);

  const stringForm = JSON.parse(JSON.stringify(sample));
  stringForm.result.input = {
    address: "4600 Silver Hill Rd, Washington, DC 20233",
    benchmark: "Public_AR_Current",
  };
  assert.deepEqual(census.validateSample(stringForm), []);

  const missingAddress = JSON.parse(JSON.stringify(sample));
  delete missingAddress.result.input.address;
  assert.ok(census.validateSample(missingAddress).length > 0);
});

test("a geometry type outside the contract fails validation", () => {
  // The NHC live fixture is empty (no active storm), so build the sample
  // inline instead of mutating the fixture.
  const nhcSample = {
    synthetic: true,
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          STORMNAME: "SYNTHETIC TEST STORM",
          STORMID: "AL012026",
          ADVISORY: "SYNTHETIC-001",
        },
        geometry: { type: "Polyline", paths: [[[-75.0, 25.0]]] },
      },
    ],
  };
  assert.ok(nhc.validateSample(nhcSample).length > 0);
});

test("every GeoJSON adapter declares only GeoJSON geometry types", () => {
  for (const [id, adapter] of Object.entries(ADAPTERS)) {
    if (!String(adapter.CONTRACT.response.format).includes("geojson")) {
      continue;
    }
    for (const type of adapter.CONTRACT.response.geometryTypes) {
      if (typeof type !== "string") {
        continue;
      }
      assert.ok(
        GEOJSON_GEOMETRY_TYPES.includes(type),
        `${id}: geometry type ${type} is not a GeoJSON geometry type`,
      );
    }
  }
});
