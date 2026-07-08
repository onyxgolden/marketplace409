import type {
  ManualPropertyAssignmentInput,
  ManualPropertyAssignmentResult,
  ManualPropertyAssignmentService,
} from "./manual-property-assignment.service";

export type BulkPropertyAssignmentInput = Readonly<{
  assignments: readonly ManualPropertyAssignmentInput[];
  ownerId?: string | null;
  organizationId?: string | null;
}>;

export type BulkPropertyAssignmentResult = Readonly<{
  assignments: readonly ManualPropertyAssignmentResult[];
  assignedCount: number;
  failedCount: number;
}>;

type ManualPropertyAssignmentServiceLike = Pick<
  ManualPropertyAssignmentService,
  "assignTransactionToProperty"
>;

export class BulkPropertyAssignmentService {
  constructor(
    private readonly dependencies: {
      manualAssignmentService: ManualPropertyAssignmentServiceLike;
    },
  ) {}

  async assignTransactionsToProperty({
    assignments,
    ownerId = null,
    organizationId = null,
  }: BulkPropertyAssignmentInput): Promise<BulkPropertyAssignmentResult> {
    if (assignments.length === 0) {
      throw new Error("Bulk property assignment requires at least one assignment.");
    }

    const results: ManualPropertyAssignmentResult[] = [];

    for (const assignment of assignments) {
      const result =
        await this.dependencies.manualAssignmentService.assignTransactionToProperty({
          ...assignment,
          ownerId: assignment.ownerId ?? ownerId,
          organizationId: assignment.organizationId ?? organizationId,
        });

      results.push(result);
    }

    return Object.freeze({
      assignments: Object.freeze([...results]),
      assignedCount: results.length,
      failedCount: 0,
    });
  }
}
