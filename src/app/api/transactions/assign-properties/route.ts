import { NextResponse } from "next/server";

import { createTransactionReviewApplicationSuite } from "@/infrastructure/composition";
import {
  TransactionReviewItem,
  type TransactionReviewItemInput,
} from "@/domains/transaction-review";
import type { Property } from "@/domains/property";
import type { Transaction } from "@/domains/transaction";

type BulkAssignPropertyRequestBody = Readonly<{
  assignments?: readonly BulkAssignPropertyRequestItem[];
  ownerId?: string | null;
  organizationId?: string | null;
}>;

type BulkAssignPropertyRequestItem = Readonly<{
  transaction?: Transaction;
  property?: Property;
  ownerId?: string | null;
  organizationId?: string | null;
  reviewItem?: TransactionReviewItemInput;
}>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BulkAssignPropertyRequestBody;

    if (!Array.isArray(body.assignments)) {
      return NextResponse.json(
        { error: "assignments is required." },
        { status: 400 },
      );
    }

    if (body.assignments.length === 0) {
      return NextResponse.json(
        { error: "assignments must contain at least one assignment." },
        { status: 400 },
      );
    }

    for (const assignment of body.assignments) {
      if (!isTransaction(assignment.transaction)) {
        return NextResponse.json(
          { error: "assignment transaction is required." },
          { status: 400 },
        );
      }

      if (!isProperty(assignment.property)) {
        return NextResponse.json(
          { error: "assignment property is required." },
          { status: 400 },
        );
      }
    }

    const { bulkAssignmentService } =
      createTransactionReviewApplicationSuite();

    const result =
      await bulkAssignmentService.assignTransactionsToProperty({
        assignments: body.assignments.map((assignment) => ({
          transaction: assignment.transaction as Transaction,
          property: assignment.property as Property,
          ownerId: normalizeNullableString(assignment.ownerId),
          organizationId: normalizeNullableString(
            assignment.organizationId,
          ),
          reviewItem: assignment.reviewItem
            ? new TransactionReviewItem(assignment.reviewItem)
            : undefined,
        })),
        ownerId: normalizeNullableString(body.ownerId),
        organizationId: normalizeNullableString(body.organizationId),
      });

    return NextResponse.json({
      success: true,
      assignments: result.assignments,
      assignedCount: result.assignedCount,
      failedCount: result.failedCount,
    });
  } catch (error) {
    console.error("Bulk property assignment error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to assign transactions to properties.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function isTransaction(value: unknown): value is Transaction {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const transaction = value as Partial<Transaction>;

  return (
    typeof transaction.id === "string" &&
    typeof transaction.financialAccountId === "string" &&
    typeof transaction.connectionId === "string" &&
    typeof transaction.provider === "string" &&
    typeof transaction.providerTransactionId === "string" &&
    typeof transaction.providerAccountId === "string" &&
    typeof transaction.amountCents === "number" &&
    typeof transaction.currencyCode === "string" &&
    typeof transaction.date === "string" &&
    typeof transaction.description === "string" &&
    (
      typeof transaction.merchantName === "string" ||
      transaction.merchantName === null
    ) &&
    Array.isArray(transaction.category) &&
    typeof transaction.pending === "boolean" &&
    typeof transaction.createdAt === "string"
  );
}

function isProperty(value: unknown): value is Property {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const property = value as Partial<Property>;

  return (
    typeof property.id === "string" &&
    (
      typeof property.name === "string" ||
      property.name == null
    )
  );
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}
