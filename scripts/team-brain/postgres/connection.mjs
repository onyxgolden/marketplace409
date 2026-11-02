// Team Brain P7 — trusted database connection adapter.
//
// Execution identity comes from the CONNECTION, never from a per-run
// label (TBP6-006). This module is the only place worker/observer
// connections are built: it takes deployment config (host, user,
// password-via-environment-variable-name, TLS), builds a pg Pool,
// and verifies the connection's own current_user matches the expected
// role before the handle is handed out. A caller that tries to pass
// a per-call `role` label is refused outright — there is no label
// parameter anywhere in this module.
//
// Secrets: the password is read from process.env at connect time and
// is never written into a config object, a log line, or a receipt.
// Config validation (worker/config.mjs) rejects any `password` key
// in config files; this module only ever reads passwordEnv names.
//
// The pg Pool path cannot be exercised without a real PostgreSQL
// server, so it is proven at host qualification (qualified Windows
// host, real server). Everything testable without a server —
// validation, TLS rules, role refusal, current_user verification —
// is tested with fake pools in tbp7Worker.test.mjs.

export const CONSOLIDATOR_ROLE = "tb_consolidator";
export const READER_ROLE = "tb_reader";

export class WorkerConnectionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "WorkerConnectionError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  // The code is part of the message so operators (and tests) can match
  // on the text alone; .code carries it structurally as well.
  throw new WorkerConnectionError(code, `${code}: ${message}`, detail);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Resolve TLS settings from validated endpoint config. Remote hosts
 * require verified TLS; localhost may skip TLS only when the caller
 * explicitly opts into insecure-local (isolated test/qualification
 * use). Anything else fails loud.
 */
export function resolveTls(endpoint) {
  const host = endpoint.host ?? "localhost";
  if (LOCAL_HOSTS.has(host)) {
    if (endpoint.ssl === false) {
      if (endpoint.allowInsecureLocal !== true) {
        fail(
          "TLS_REQUIRED",
          "localhost connections with ssl:false require explicit allowInsecureLocal:true",
          { host },
        );
      }
      return false;
    }
    return { rejectUnauthorized: true };
  }
  if (
    endpoint.ssl == null ||
    endpoint.ssl === false ||
    (typeof endpoint.ssl === "object" && endpoint.ssl.rejectUnauthorized === false)
  ) {
    fail(
      "TLS_REQUIRED",
      `non-localhost host ${host} requires verified TLS (ssl with rejectUnauthorized true)`,
      { host },
    );
  }
  return typeof endpoint.ssl === "object" ? endpoint.ssl : { rejectUnauthorized: true };
}

/**
 * Build a pg Pool from trusted endpoint config. `createPool` is
 * injected (pg.Pool in production, a fake in tests) so this module
 * never imports a driver itself. The password comes from the named
 * environment variable at this moment only; it is not returned.
 */
export function createTrustedPool(endpoint, { expectedRole, createPool, env = process.env } = {}) {
  if (endpoint == null || typeof endpoint !== "object") {
    fail("INVALID_ENDPOINT", "database endpoint config is required", {});
  }
  if ("role" in endpoint) {
    fail(
      "ROLE_LABEL_REFUSED",
      "per-call role labels are refused: execution identity comes from the connection, not a label",
      {},
    );
  }
  if (typeof endpoint.user !== "string" || endpoint.user === "") {
    fail("INVALID_ENDPOINT", "database endpoint user is required", {});
  }
  if (expectedRole != null && endpoint.user !== expectedRole) {
    fail(
      "ROLE_MISMATCH",
      `endpoint user ${endpoint.user} does not match expected role ${expectedRole}`,
      { user: endpoint.user, expectedRole },
    );
  }
  if (typeof endpoint.passwordEnv !== "string" || endpoint.passwordEnv === "") {
    fail("INVALID_ENDPOINT", "database endpoint passwordEnv is required (never an inline password)", {});
  }
  const password = env[endpoint.passwordEnv];
  if (typeof password !== "string" || password === "") {
    fail(
      "MISSING_CREDENTIAL",
      `environment variable ${endpoint.passwordEnv} is unset or empty; credentials come from the vault-provided environment, never from config files`,
      { passwordEnv: endpoint.passwordEnv },
    );
  }
  const ssl = resolveTls(endpoint);
  if (typeof createPool !== "function") {
    fail("NO_POOL_FACTORY", "createTrustedPool requires a createPool factory (pg.Pool in production)", {});
  }
  return createPool({
    host: endpoint.host ?? "localhost",
    port: endpoint.port ?? 5432,
    database: endpoint.database,
    user: endpoint.user,
    password,
    ssl,
  });
}

/** Verify a connected client's own current_user equals the expected role. */
export async function assertCurrentUser(client, expectedRole) {
  const { rows } = await client.query("SELECT current_user");
  const current = rows?.[0]?.current_user;
  if (current !== expectedRole) {
    fail(
      "ROLE_DENIED",
      `connection identity ${current} is not the required role ${expectedRole}`,
      { current, expectedRole },
    );
  }
  return current;
}

/**
 * Check out a client from a pool, verify its identity, run fn, and
 * always release. The engine receives the checked-out client (one
 * physical connection), never the pool.
 */
export async function withTrustedClient(pool, expectedRole, fn) {
  const client = await pool.connect();
  try {
    await assertCurrentUser(client, expectedRole);
    return await fn(client);
  } finally {
    if (typeof client.release === "function") client.release();
  }
}
