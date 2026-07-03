import { TransactionReviewItem } from "./transaction-review-item";

import {
  TransactionReviewAssignmentStatus,
  TransactionReviewState,
} from "./transaction-review-item";

export class TransactionReviewWorkflowService {
  transitionAssignment(
    item: TransactionReviewItem,
    next: TransactionReviewAssignmentStatus
  ): TransactionReviewItem {
    return new TransactionReviewItem({
      ...item,
      assignmentStatus: next,
    });
  }

  transitionReview(
    item: TransactionReviewItem,
    next: TransactionReviewState
  ): TransactionReviewItem {
    return new TransactionReviewItem({
      ...item,
      reviewState: next,
    });
  }
}
