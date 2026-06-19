/**
 * GeneralLedgerRepository
 *
 * Domain repository contract.
 * Infrastructure implementations (Supabase, Postgres, etc.)
 * must implement this interface.
 */
export class GeneralLedgerRepository {
  load() {
    throw new Error("Not implemented");
  }

  save(_ledger) {
    throw new Error("Not implemented");
  }
}
