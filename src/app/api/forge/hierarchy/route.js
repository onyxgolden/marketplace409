// FORGE shared client -> site -> project foundation (PR A).
// GET returns the selector tree (or validates one ?projectId= hint);
// POST creates a client/site/project; PATCH updates one (rename, status,
// reparent); DELETE hard-deletes an archived record with no children.
// Every mutation goes through the SECURITY DEFINER RPCs in the
// application service — the route never writes hierarchy tables directly.
// The request ID is the idempotency key: the client sends one fresh UUID
// per logical change; the route generates one when omitted so every
// mutation carries one.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  createHierarchyClient,
  createHierarchyProject,
  createHierarchySite,
  deleteHierarchyClient,
  deleteHierarchyProject,
  deleteHierarchySite,
  getHierarchySelector,
  updateHierarchyClient,
  updateHierarchyProject,
  updateHierarchySite,
  validateHierarchySelection,
} from "@/application/forge-shared-hierarchy/hierarchy";

function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

function fail(result) {
  return json({ error: result.error }, result.httpStatus || 400);
}

function serverError(route, error) {
  console.error(route, error);
  return json({ error: "Unable to complete the request." }, 500);
}

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

function requestIdOrNew(body) {
  return body?.requestId || crypto.randomUUID();
}

function badExpectedVersion() {
  return fail({
    ok: false,
    httpStatus: 400,
    error: "expectedVersion must be a positive whole number.",
  });
}

export async function GET(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (projectId) {
      const result = await validateHierarchySelection(authenticated.supabaseClient, {
        ownerId: authenticated.effectiveOwnerId,
        projectId,
      });
      if (!result.ok) return fail(result);
      return json({ selection: result.selection });
    }
    const result = await getHierarchySelector(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
    });
    if (!result.ok) return fail(result);
    return json({ selector: result.selector });
  } catch (error) {
    return serverError("GET /api/forge/hierarchy", error);
  }
}

export async function POST(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    const ownerId = authenticated.effectiveOwnerId;
    const requestId = requestIdOrNew(body);
    if (body.entity === "client") {
      const result = await createHierarchyClient(authenticated.supabaseClient, {
        ownerId,
        name: body.name,
        externalReference: body.externalReference,
        notes: body.notes,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ client: result.client });
    }
    if (body.entity === "site") {
      const result = await createHierarchySite(authenticated.supabaseClient, {
        ownerId,
        clientId: body.clientId,
        name: body.name,
        siteType: body.siteType,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2,
        city: body.city,
        region: body.region,
        postalCode: body.postalCode,
        countryCode: body.countryCode,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ site: result.site });
    }
    if (body.entity === "project") {
      const result = await createHierarchyProject(authenticated.supabaseClient, {
        ownerId,
        siteId: body.siteId,
        name: body.name,
        projectCode: body.projectCode,
        description: body.description,
        projectType: body.projectType,
        plannedStart: body.plannedStart,
        plannedFinish: body.plannedFinish,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ project: result.project });
    }
    return fail({ ok: false, httpStatus: 400, error: "entity must be client, site, or project." });
  } catch (error) {
    return serverError("POST /api/forge/hierarchy", error);
  }
}

export async function PATCH(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    // Optimistic concurrency is mandatory — a missing/invalid
    // expectedVersion is a 400 here, before the RPC.
    if (
      body.expectedVersion === undefined ||
      body.expectedVersion === null ||
      !Number.isInteger(body.expectedVersion) ||
      body.expectedVersion < 1
    ) {
      return badExpectedVersion();
    }
    const ownerId = authenticated.effectiveOwnerId;
    const requestId = requestIdOrNew(body);
    if (body.entity === "client") {
      const result = await updateHierarchyClient(authenticated.supabaseClient, {
        ownerId,
        clientId: body.id,
        name: body.name,
        externalReference: body.externalReference,
        notes: body.notes,
        status: body.status,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ client: result.client });
    }
    if (body.entity === "site") {
      const result = await updateHierarchySite(authenticated.supabaseClient, {
        ownerId,
        siteId: body.id,
        clientId: body.clientId,
        name: body.name,
        siteType: body.siteType,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2,
        city: body.city,
        region: body.region,
        postalCode: body.postalCode,
        countryCode: body.countryCode,
        status: body.status,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ site: result.site });
    }
    if (body.entity === "project") {
      const result = await updateHierarchyProject(authenticated.supabaseClient, {
        ownerId,
        projectId: body.id,
        siteId: body.siteId,
        name: body.name,
        projectCode: body.projectCode,
        description: body.description,
        projectType: body.projectType,
        plannedStart: body.plannedStart,
        plannedFinish: body.plannedFinish,
        status: body.status,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ project: result.project });
    }
    return fail({ ok: false, httpStatus: 400, error: "entity must be client, site, or project." });
  } catch (error) {
    return serverError("PATCH /api/forge/hierarchy", error);
  }
}

export async function DELETE(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json().catch(() => ({}));
    if (
      body.expectedVersion === undefined ||
      body.expectedVersion === null ||
      !Number.isInteger(body.expectedVersion) ||
      body.expectedVersion < 1
    ) {
      return badExpectedVersion();
    }
    const ownerId = authenticated.effectiveOwnerId;
    const requestId = requestIdOrNew(body);
    if (body.entity === "client") {
      const result = await deleteHierarchyClient(authenticated.supabaseClient, {
        ownerId,
        clientId: body.id,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ deleted: result.deleted, id: result.id });
    }
    if (body.entity === "site") {
      const result = await deleteHierarchySite(authenticated.supabaseClient, {
        ownerId,
        siteId: body.id,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ deleted: result.deleted, id: result.id });
    }
    if (body.entity === "project") {
      const result = await deleteHierarchyProject(authenticated.supabaseClient, {
        ownerId,
        projectId: body.id,
        expectedVersion: body.expectedVersion,
        requestId,
      });
      if (!result.ok) return fail(result);
      return json({ deleted: result.deleted, id: result.id });
    }
    return fail({ ok: false, httpStatus: 400, error: "entity must be client, site, or project." });
  } catch (error) {
    return serverError("DELETE /api/forge/hierarchy", error);
  }
}
