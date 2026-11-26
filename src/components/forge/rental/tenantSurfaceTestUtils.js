// Slice 1 test helper: build the narrow-surface payloads the tenant panel
// fetches, from the same master-shaped fixture the old monolith stubs used.
// The list surface carries compact rows + paging; the detail surface carries
// the requested tenant's full row + household arrays + overrides.
//
// Usage inside a fetch stub (before the catch-all GET branch):
//   const routed = routeTenantSurfaceGet(url, { tenants, leases, leaseMemberships, units, openCharges });
//   if (routed) return { ok: true, json: async () => routed };
// `source` is read at call time, so closures over mutable tenant lists stay
// correct across the test.

export function tenantIdFromUrl(url) {
  return decodeURIComponent(String(url).match(/tenantId=([^&]+)/)?.[1] || "");
}

export function tenantListPayload(source) {
  const tenants = source.tenants || [];
  return { ...source, totalCount: tenants.length, page: 1, pageSize: 50 };
}

export function tenantDetailPayload(source, tenantId) {
  const tenant = (source.tenants || []).find((item) => item.id === tenantId);
  return { ...source, tenant: tenant || null, notFound: !tenant,
    lateFeeTenantOverride: null, paymentPolicy: "allow_any_amount" };
}

// Route a GET url to the right surface payload, or null when the url is not
// a tenant surface (the caller's other branches -- ledger, POSTs -- apply).
export function routeTenantSurfaceGet(url, source) {
  if (String(url).includes("surface=tenant-detail")) {
    return tenantDetailPayload(source, tenantIdFromUrl(url));
  }
  if (String(url).includes("surface=tenants")) {
    return tenantListPayload(source);
  }
  return null;
}
