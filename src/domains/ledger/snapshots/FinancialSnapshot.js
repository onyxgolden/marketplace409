export class FinancialSnapshot {
  constructor({
    id,
    capturedAt,
    period,
    kpis,
    health,
    metadata = {},
  }) {
    if (!id) {
      throw new Error("FinancialSnapshot requires an id.");
    }

    if (!capturedAt) {
      throw new Error("FinancialSnapshot requires capturedAt.");
    }

    this.id = id;
    this.capturedAt = capturedAt;
    this.period = Object.freeze({
      start: period?.start || null,
      end: period?.end || null,
    });

    this.kpis = Object.freeze({
      cash: Number(kpis?.cash || 0),
      receivables: Number(kpis?.receivables || 0),
      debt: Number(kpis?.debt || 0),
      revenue: Number(kpis?.revenue || 0),
      expenses: Number(kpis?.expenses || 0),
      assets: Number(kpis?.assets || 0),
      liabilities: Number(kpis?.liabilities || 0),
      equity: Number(kpis?.equity || 0),
      profit: Number(kpis?.profit || 0),
      margin: Number(kpis?.margin || 0),
    });

    this.health = Object.freeze({
      label: health?.label || "Unknown",
      detail: health?.detail || "",
    });

    this.metadata = Object.freeze({ ...metadata });

    Object.freeze(this);
  }

  static fromDashboard({ id, capturedAt, period, dashboard }) {
    return new FinancialSnapshot({
      id,
      capturedAt,
      period,
      kpis: dashboard?.kpis,
      health: dashboard?.health,
      metadata: dashboard?.metadata,
    });
  }
}

Object.freeze(FinancialSnapshot);
