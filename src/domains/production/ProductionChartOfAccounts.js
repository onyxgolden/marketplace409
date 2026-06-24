import {
  Account,
  AccountType,
  ChartOfAccounts,
} from "../ledger/accounts";

export function buildProductionChartOfAccounts() {
  return new ChartOfAccounts([
    new Account({
      id: "1000",
      name: "Cash",
      type: AccountType.ASSET,
    }),
    new Account({
      id: "1500",
      name: "Real Estate",
      type: AccountType.ASSET,
    }),
    new Account({
      id: "4000",
      name: "Rental Income",
      type: AccountType.REVENUE,
    }),
    new Account({
      id: "4010",
      name: "CAM Income",
      type: AccountType.REVENUE,
    }),
    new Account({
      id: "5100",
      name: "Repairs Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5110",
      name: "Maintenance Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5120",
      name: "Supplies Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5200",
      name: "Utilities Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5300",
      name: "Insurance Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5400",
      name: "Mortgage Interest Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5500",
      name: "Property Tax Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5600",
      name: "Professional Fees Expense",
      type: AccountType.EXPENSE,
    }),
    new Account({
      id: "5999",
      name: "Other Expense",
      type: AccountType.EXPENSE,
    }),
  ]);
}
