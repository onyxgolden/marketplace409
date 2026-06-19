import { GeneralLedger } from "../entities/GeneralLedger";
import { GeneralLedgerRepository } from "./GeneralLedgerRepository";

/**
 * InMemoryGeneralLedgerRepository
 *
 * Infrastructure implementation used for tests, local development,
 * and future service-layer wiring before database persistence exists.
 */
export class InMemoryGeneralLedgerRepository extends GeneralLedgerRepository {
  constructor(ledger = GeneralLedger.create()) {
    super();

    this._ledger = ledger;
  }

  load() {
    return this._ledger;
  }

  save(ledger) {
    this._ledger = ledger;
  }
}
