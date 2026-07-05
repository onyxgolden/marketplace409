import { AutonomousAuditAgent } from "./AutonomousAuditAgent";
import { GeneralLedger } from "../entities/GeneralLedger";
import { Posting } from "../entities/Posting";
import { LedgerDirection } from "../value-objects";
import { Money } from "@/platform";

describe("AutonomousAuditAgent", () => {
  function posting({
    id,
    accountId,
    amount,
    metadata = {},
  }) {
    return new Posting({
      id,
      accountId,
      amount: new Money(amount),
      direction: LedgerDirection.DEBIT,
      metadata,
    });
  }

  test("returns no findings for a healthy ledger", () => {
    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "4000",
        amount: 5000,
        metadata: {
          event: {
            id: "event-1",
            description: "Rent",
            amount: 5000,
          },
        },
      }),
    ]);

    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        sourceRecordIds: [],
      }),
    };

    const intelligence = {
      explain: () => ({
        summary: "Healthy",
      }),
    };

    const agent = new AutonomousAuditAgent(
      resolver,
      intelligence
    );

    expect(agent.run({ ledger })).toEqual([]);
  });

  test("detects missing metadata anomaly", () => {
    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "4000",
        amount: 5000,
        metadata: null,
      }),
    ]);

    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        sourceRecordIds: [],
      }),
    };

    const intelligence = {
      explain: () => ({
        summary: "Missing metadata",
      }),
    };

    const agent = new AutonomousAuditAgent(
      resolver,
      intelligence
    );

    const findings = agent.run({ ledger });

    expect(findings).toHaveLength(1);
    expect(findings[0].anomalies).toContain(
      "Missing metadata on ledger entry"
    );
  });

  test("detects use of unclassified account", () => {
    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "9999",
        amount: 5000,
      }),
    ]);

    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "9999",
        sourceRecordIds: [],
      }),
    };

    const intelligence = {
      explain: () => ({
        summary: "Unclassified",
      }),
    };

    const agent = new AutonomousAuditAgent(
      resolver,
      intelligence
    );

    const findings = agent.run({ ledger });

    expect(findings).toHaveLength(1);
    expect(findings[0].anomalies).toContain(
      "Unclassified account usage"
    );
  });
  test("detects large Money-object transactions", () => {
    const ledger = GeneralLedger.fromEntries([
      posting({
        id: "posting-1",
        accountId: "4000",
        amount: 150000,
      }),
    ]);

    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        sourceRecordIds: [],
      }),
    };

    const intelligence = {
      explain: () => ({
        summary: "Large transaction",
      }),
    };

    const agent = new AutonomousAuditAgent(
      resolver,
      intelligence
    );

    const findings = agent.run({ ledger });

    expect(findings).toHaveLength(1);
    expect(findings[0].anomalies).toContain(
      "Large transaction detected"
    );
  });
});
