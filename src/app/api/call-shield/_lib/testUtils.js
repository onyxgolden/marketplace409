// Shared fluent-query mock for Call Shield API route tests.
// Every chainable method returns the builder; awaiting the builder (at any
// chain depth) resolves to the queued result. `from()` consumes one queued
// result per call, in order.
import { vi } from "vitest";

export function queryBuilder(result, calls) {
  const builder = {};
  const methods = [
    "select", "eq", "neq", "order", "limit", "is", "in",
    "insert", "upsert", "update", "delete", "maybeSingle", "single",
  ];
  for (const method of methods) {
    builder[method] = (...args) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

export function mockSupabase(queuedResults) {
  const calls = [];
  const queue = [...queuedResults];
  const from = vi.fn(() => queryBuilder(queue.length ? queue.shift() : { data: null, error: null }, calls));
  return { from, _calls: calls };
}

export function authedGuard(guardCallShieldRequest, supabaseClient, userId = "owner-1") {
  guardCallShieldRequest.mockResolvedValue({ user: { id: userId }, supabaseClient });
}

export async function postJson(routeModule, path, body, params) {
  const { NextRequest } = await import("next/server");
  const request = new NextRequest(path, { method: "POST", body: JSON.stringify(body) });
  return routeModule.POST(request, { params: Promise.resolve(params || {}) });
}
