import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { computeResourceLoading, detectOverallocations, rollupCostByAccount, rollupProjectCost } from "@/domains/scheduling/schedulingResources";
import { loadProjectRelational, loadResourceCostData, computeAndPersistCpm } from "../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

// Read-only, owner-only (see loadResourceCostData / the SCHED-05 migration's no-public-select
// decision) -- a non-owner viewing the shared example project's schedule never sees its cost data,
// even though they can see its dates/CPM/baselines. RLS already enforces this (schedule_resources/
// schedule_resource_assignments/schedule_expenses have no public-select policy); the owner check
// below just turns that into a clean 404 instead of a confusing "$0 for everything" response.
//
// SCHED-19: an optional ?costAccountId= query param narrows byBlock/project down to just the
// assignments/expenses tagged with that one cost code (a PO#/WO#) -- same rollupProjectCost call,
// just fed a pre-filtered slice of assignments/expenses, so "Cost by activity" naturally becomes
// "Cost by activity for this code" with no separate aggregation path to maintain. byCostAccount (the
// project-wide summary grouped by code) is only computed on the unfiltered request -- once a code is
// selected there's nothing left to summarize across.
export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId } = await params;
    const costAccountId = new URL(request.url).searchParams.get("costAccountId") || null;

    const relational = await loadProjectRelational(authenticated.supabaseClient, projectId);
    if (!relational.project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    if (relational.project.owner_id !== authenticated.user.id) return NextResponse.json({ error: "You don't own this project." }, { status: 404 });

    const { cpmBlocks } = await computeAndPersistCpm(authenticated.supabaseClient, relational.project, relational);
    const { resources, assignments, expenses, costAccounts } = await loadResourceCostData(authenticated.supabaseClient, relational);

    const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
    const blocksById = new Map(cpmBlocks.map((block) => [block.id, block]));
    const taskCodeByBlockId = new Map(relational.blocks.map((block) => [block.id, block.task_code]));
    const calendarsById = new Map(relational.calendars.map((calendar) => [calendar.id, calendar]));
    const lanesById = new Map(relational.lanes.map((lane) => [lane.id, lane]));

    const scopedAssignments = costAccountId ? assignments.filter((assignment) => assignment.cost_account_id === costAccountId) : assignments;
    const scopedExpenses = costAccountId ? expenses.filter((expense) => expense.cost_account_id === costAccountId) : expenses;

    const costRollup = rollupProjectCost({ assignments: scopedAssignments, resourcesById, expenses: scopedExpenses });
    const byBlock = costRollup.byBlock.map((row) => ({ ...row, task_code: taskCodeByBlockId.get(row.block_id) || null }));

    const loading = computeResourceLoading({
      assignments: scopedAssignments, blocksById, calendarsById, lanesById,
      holidaysByCalendarId: new Map(), // matches computeAndPersistCpm's own holidays:[] simplification -- no holiday data fetched anywhere in this API yet.
      project: relational.project,
    });
    const overallocations = detectOverallocations({ loading, resourcesById });

    let byCostAccount;
    if (!costAccountId) {
      const costAccountsById = new Map(costAccounts.map((account) => [account.id, account]));
      byCostAccount = rollupCostByAccount({ assignments, resourcesById, expenses }).map((row) => ({
        ...row,
        code: row.cost_account_id ? costAccountsById.get(row.cost_account_id)?.code ?? null : null,
        name: row.cost_account_id ? costAccountsById.get(row.cost_account_id)?.name ?? null : "Uncoded",
      }));
    }

    return NextResponse.json({ success: true, byBlock, project: costRollup.project, overallocations, byCostAccount });
  } catch (error) {
    console.error("Scheduling cost rollup error", error);
    return NextResponse.json({ error: "Unable to compute cost rollup for this project." }, { status: 500 });
  }
}
