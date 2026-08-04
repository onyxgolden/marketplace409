import { NextResponse } from "next/server";

import {
  createAuthenticatedForgeApplication,
} from "@/lib/supabase/createAuthenticatedForgeApplication";
import {
  TransactionReviewItem,
  type TransactionReviewItemInput,
} from "@/domains/transaction-review";
import type { Property } from "@/domains/property";
import type { Transaction } from "@/domains/transaction";

type AssignPropertyRequestBody = Readonly<{
  transaction?: Transaction;
  property?: Property;
  reviewItem?: TransactionReviewItemInput;
}>;

export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedForgeApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const body =
      (await request.json()) as AssignPropertyRequestBody;

    if (!isTransaction(body.transaction)) {
      return NextResponse.json(
        {
          error:
            "transaction is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!isProperty(body.property)) {
      return NextResponse.json(
        {
          error:
            "property is required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      transactionReviewApplicationSuite,
    } =
      await authenticatedApplication
        .getForgeApplicationSuite();

    const {
      manualAssignmentService,
    } = transactionReviewApplicationSuite;

    const result =
      await manualAssignmentService
        .assignTransactionToProperty({
          transaction:
            body.transaction,
          property:
            body.property,
          ownerId:
            authenticatedApplication.user.id,
          organizationId:
            null,
          reviewItem:
            body.reviewItem
              ? new TransactionReviewItem(
                  body.reviewItem,
                )
              : undefined,
        });

    return NextResponse.json({
      success: true,
      transaction:
        result.transaction,
      property:
        result.property,
      rule:
        result.rule,
      reviewItem:
        result.reviewItem,
    });
  } catch (error) {
    console.error(
      "Manual property assignment error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to assign transaction to property.";

    return NextResponse.json(
      {
        error:
          message,
      },
      {
        status: 500,
      },
    );
  }
}

function isTransaction(
  value: unknown,
): value is Transaction {
  if (
    value == null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const transaction =
    value as Partial<Transaction>;

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

function isProperty(
  value: unknown,
): value is Property {
  if (
    value == null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const property =
    value as Partial<Property>;

  return (
    typeof property.id === "string" &&
    (
      typeof property.name === "string" ||
      property.name == null
    )
  );
}
