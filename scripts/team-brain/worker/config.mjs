// Team Brain P7 — validated worker configuration.
//
// Config files carry NO secrets: credentials arrive only via named
// environment variables (passwordEnv), resolved at connect time.
// Validation fails loud: unknown keys, inline passwords, wrong roles,
// non-Chicago slots, and missing credential variables are all refused
// at startup, never silently defaulted into authority. The engine
// pins the slot to 03:00 America/Chicago, so config must agree with
// it exactly or refuse.

import { CONSOLIDATOR_ROLE, READER_ROLE } from "../postgres/connection.mjs";

export const CONFIG_SCHEMA_VERSION = "7.0";
export const SLOT = Object.freeze({ timeZone: "America/Chicago", hour: 3, minute: 0 });
export const DEFAULT_RETENTION = Object.freeze({ dailyVersions: 30, rpoHours: 24, rtoHours: 4 });

export class WorkerConfigError extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = "WorkerConfigError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new WorkerConfigError(code, message, detail);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function assertNoPasswordKey(value, path) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPasswordKey(v, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.toLowerCase() === "password") {
        fail("PASSWORD_IN_CONFIG", `inline password key refused at ${path}.${k}: credentials come only via passwordEnv`, { path });
      }
      assertNoPasswordKey(v, `${path}.${k}`);
    }
  }
}

function checkKeys(obj, allowed, path) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) fail("UNKNOWN_CONFIG_KEY", `unknown config key ${path}.${k}`, { path, key: k });
  }
}

function nonEmptyString(v, path, code = "BAD_CONFIG_VALUE") {
  if (typeof v !== "string" || v === "") fail(code, `${path} must be a non-empty string`, { path });
  return v;
}

function validateEndpoint(raw, path, expectedRole, env) {
  if (!isPlainObject(raw)) fail("BAD_ENDPOINT", `${path} must be an object`, { path });
  checkKeys(raw, new Set(["host", "port", "database", "user", "passwordEnv", "ssl", "allowInsecureLocal"]), path);
  const host = raw.host == null ? "localhost" : nonEmptyString(raw.host, `${path}.host`);
  let port = 5432;
  if (raw.port != null) {
    if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
      fail("BAD_PORT", `${path}.port must be an integer 1-65535`, { path });
    }
    port = raw.port;
  }
  const database = nonEmptyString(raw.database, `${path}.database`);
  const user = nonEmptyString(raw.user, `${path}.user`);
  if (user !== expectedRole) {
    const code = expectedRole === CONSOLIDATOR_ROLE ? "BAD_WORKER_ROLE" : "BAD_OBSERVER_ROLE";
    fail(code, `${path}.user must be ${expectedRole} (got ${user})`, { path, user, expectedRole });
  }
  const passwordEnv = nonEmptyString(raw.passwordEnv, `${path}.passwordEnv`);
  if (typeof env[passwordEnv] !== "string" || env[passwordEnv] === "") {
    fail("MISSING_PASSWORD_ENV", `${path}.passwordEnv ${passwordEnv} is unset or empty in the environment`, { path, passwordEnv });
  }
  const ssl = raw.ssl === undefined ? true : raw.ssl;
  if (typeof ssl !== "boolean" && !isPlainObject(ssl)) {
    fail("BAD_SSL", `${path}.ssl must be a boolean or an object`, { path });
  }
  const allowInsecureLocal = raw.allowInsecureLocal === true;
  return Object.freeze({ host, port, database, user, passwordEnv, ssl, allowInsecureLocal });
}

/**
 * Validate raw worker config into a frozen normalized config. Throws
 * WorkerConfigError on any violation. Never includes a password value.
 */
export function validateWorkerConfig(raw, { env = process.env } = {}) {
  if (!isPlainObject(raw)) fail("BAD_CONFIG", "worker config must be an object", {});
  assertNoPasswordKey(raw, "config");
  checkKeys(
    raw,
    new Set(["workerId", "database", "observer", "principal", "stopFile", "backupDir", "slot", "retention", "configSchemaVersion"]),
    "config",
  );
  const workerId = nonEmptyString(raw.workerId, "config.workerId", "BAD_WORKER_ID");
  const principal = nonEmptyString(raw.principal, "config.principal", "BAD_PRINCIPAL");
  if (raw.database == null) fail("MISSING_ENDPOINT", "config.database is required", {});
  if (raw.observer == null) fail("MISSING_ENDPOINT", "config.observer is required", {});
  const database = validateEndpoint(raw.database, "config.database", CONSOLIDATOR_ROLE, env);
  const observer = validateEndpoint(raw.observer, "config.observer", READER_ROLE, env);
  let slot = SLOT;
  if (raw.slot != null) {
    if (!isPlainObject(raw.slot)) fail("BAD_SLOT", "config.slot must be an object", {});
    checkKeys(raw.slot, new Set(["timeZone", "hour", "minute"]), "config.slot");
    if (
      raw.slot.timeZone !== SLOT.timeZone ||
      raw.slot.hour !== SLOT.hour ||
      raw.slot.minute !== SLOT.minute
    ) {
      fail(
        "BAD_SLOT",
        `config.slot must be ${SLOT.timeZone} ${SLOT.hour}:${String(SLOT.minute).padStart(2, "0")} (the engine pins this slot); got ${JSON.stringify(raw.slot)}`,
        { slot: raw.slot },
      );
    }
    slot = SLOT;
  }
  let retention = DEFAULT_RETENTION;
  if (raw.retention != null) {
    if (!isPlainObject(raw.retention)) fail("BAD_RETENTION", "config.retention must be an object", {});
    checkKeys(raw.retention, new Set(["dailyVersions", "rpoHours", "rtoHours"]), "config.retention");
    const dailyVersions = raw.retention.dailyVersions ?? DEFAULT_RETENTION.dailyVersions;
    if (!Number.isInteger(dailyVersions) || dailyVersions < 1) {
      fail("BAD_RETENTION", "config.retention.dailyVersions must be an integer >= 1", {});
    }
    const rpoHours = raw.retention.rpoHours ?? DEFAULT_RETENTION.rpoHours;
    const rtoHours = raw.retention.rtoHours ?? DEFAULT_RETENTION.rtoHours;
    if (rpoHours !== DEFAULT_RETENTION.rpoHours || rtoHours !== DEFAULT_RETENTION.rtoHours) {
      fail(
        "BAD_RETENTION",
        `config.retention must be RPO ${DEFAULT_RETENTION.rpoHours}h / RTO ${DEFAULT_RETENTION.rtoHours}h (got RPO ${rpoHours}h / RTO ${rtoHours}h)`,
        {},
      );
    }
    retention = Object.freeze({ dailyVersions, rpoHours, rtoHours });
  }
  const configSchemaVersion = raw.configSchemaVersion ?? CONFIG_SCHEMA_VERSION;
  if (configSchemaVersion !== CONFIG_SCHEMA_VERSION) {
    fail("BAD_SCHEMA_VERSION", `config.configSchemaVersion must be ${CONFIG_SCHEMA_VERSION} (got ${configSchemaVersion})`, {});
  }
  const stopFile = raw.stopFile == null ? null : nonEmptyString(raw.stopFile, "config.stopFile");
  const backupDir = raw.backupDir == null ? null : nonEmptyString(raw.backupDir, "config.backupDir");
  return Object.freeze({
    workerId,
    database,
    observer,
    principal,
    stopFile,
    backupDir,
    slot,
    retention,
    configSchemaVersion,
  });
}
