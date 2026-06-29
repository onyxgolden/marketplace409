import { FinancialEventTranslator } from "./FinancialEventTranslator";
import { Money } from "@/platform";
import { JournalEntry, Posting } from "../ledger/entities";
import { LedgerDirection } from "../ledger/value-objects";

export const FINANCIAL_EVENT_ACCOUNTS = Object.freeze({
  CASH: "1000",
  RENTAL_INCOME: "4000",
  CAM_INCOME: "4010",
  REPAIRS_EXPENSE: "5100",
  MAINTENANCE_EXPENSE: "5110",
  SUPPLIES_EXPENSE: "5120",
  UTILITIES_EXPENSE: "5200",
  INSURANCE_EXPENSE: "5300",
  MORTGAGE_INTEREST_EXPENSE: "5400",
  PROPERTY_TAX_EXPENSE: "5500",
  PROFESSIONAL_FEES_EXPENSE: "5600",
  REAL_ESTATE_ASSET: "1500",
  OTHER_EXPENSE: "5999",
});

export class FinancialEventPostingAdapter {
  toJournalEntry(event) {
    const amount = this.toMoney(event.amount);
    const accounts = this.resolveAccounts(event);

    return new JournalEntry({
      id: `${event.id || "financial-event"}:journal-entry`,
      date: FinancialEventTranslator.getEventDate(event),
      description: event.description,
      postings: [
        new Posting({
          id: `${event.id || "financial-event"}:debit`,
          accountId: accounts.debit,
          amount,
          direction: LedgerDirection.DEBIT,
          description: event.description,
          metadata: {
            source: "financial-event",
            event,
          },
        }),
        new Posting({
          id: `${event.id || "financial-event"}:credit`,
          accountId: accounts.credit,
          amount,
          direction: LedgerDirection.CREDIT,
          description: event.description,
          metadata: {
            source: "financial-event",
            event,
          },
        }),
      ],
      metadata: {
        source: "financial-event",
        event,
      },
    });
  }

  resolveAccounts(event) {
    if (event.transaction_kind === "income") {
      return {
        debit: FINANCIAL_EVENT_ACCOUNTS.CASH,
        credit: this.resolveIncomeAccount(event),
      };
    }

    if (event.transaction_kind === "asset_purchase") {
      return {
        debit: FINANCIAL_EVENT_ACCOUNTS.REAL_ESTATE_ASSET,
        credit: FINANCIAL_EVENT_ACCOUNTS.CASH,
      };
    }

    return {
      debit: this.resolveExpenseAccount(event),
      credit: FINANCIAL_EVENT_ACCOUNTS.CASH,
    };
  }

  resolveIncomeAccount(event) {
    if (event.normalized_category === "cam_income") {
      return FINANCIAL_EVENT_ACCOUNTS.CAM_INCOME;
    }

    return FINANCIAL_EVENT_ACCOUNTS.RENTAL_INCOME;
  }

  resolveExpenseAccount(event) {
    switch (event.normalized_category) {
      case "property_repairs":
        return FINANCIAL_EVENT_ACCOUNTS.REPAIRS_EXPENSE;
      case "maintenance":
      case "cleaning_supplies":
        return FINANCIAL_EVENT_ACCOUNTS.MAINTENANCE_EXPENSE;
      case "supplies":
      case "tools":
        return FINANCIAL_EVENT_ACCOUNTS.SUPPLIES_EXPENSE;
      case "utilities":
        return FINANCIAL_EVENT_ACCOUNTS.UTILITIES_EXPENSE;
      case "insurance":
        return FINANCIAL_EVENT_ACCOUNTS.INSURANCE_EXPENSE;
      case "mortgage_interest":
        return FINANCIAL_EVENT_ACCOUNTS.MORTGAGE_INTEREST_EXPENSE;
      case "property_tax":
        return FINANCIAL_EVENT_ACCOUNTS.PROPERTY_TAX_EXPENSE;
      case "professional_fees":
      case "legal_fees":
        return FINANCIAL_EVENT_ACCOUNTS.PROFESSIONAL_FEES_EXPENSE;
      default:
        return FINANCIAL_EVENT_ACCOUNTS.OTHER_EXPENSE;
    }
  }

  toMoney(amount) {
    return new Money(Math.round(amount * 100));
  }
}

export const financialEventPostingAdapter =
  new FinancialEventPostingAdapter();
