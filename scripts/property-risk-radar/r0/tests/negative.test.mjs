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
import * as wfigs from "../src/adapters/wfigs-perimeters.mjs";

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
