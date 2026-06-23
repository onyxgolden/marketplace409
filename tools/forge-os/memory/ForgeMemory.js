const fs = require("fs");
const path = require("path");

class ForgeMemory {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;

    this.memoryFile = path.join(
      repoRoot,
      "tools/forge-os/memory/forge-memory.json"
    );

    this.state = this.load();
  }

  /**
   * =========================
   * LOAD MEMORY
   * =========================
   */
  load() {
    if (!fs.existsSync(this.memoryFile)) {
      return this._defaultState();
    }

    try {
      const raw = fs.readFileSync(this.memoryFile, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      return this._defaultState();
    }
  }

  /**
   * =========================
   * DEFAULT STATE
   * =========================
   */
  _defaultState() {
    return {
      runs: [],
      failures: {},
      successes: {},
      lastSignals: {
        biasInspect: 1,
        biasTest: 1,
        biasBuild: 1,
      },
    };
  }

  /**
   * =========================
   * SAVE MEMORY
   * =========================
   */
  save() {
    fs.mkdirSync(path.dirname(this.memoryFile), { recursive: true });

    fs.writeFileSync(
      this.memoryFile,
      JSON.stringify(this.state, null, 2),
      "utf8"
    );
  }

  /**
   * =========================
   * LOG RUN
   * =========================
   */
  logRun(intent, plan) {
    this.state.runs.push({
      intent,
      timestamp: new Date().toISOString(),
      steps: plan?.steps?.length || 0,
    });

    this.save();
  }

  /**
   * =========================
   * FAILURE TRACKING
   * =========================
   */
  logFailure(step, error) {
    const key = step?.action || "unknown";

    this.state.failures[key] =
      (this.state.failures[key] || 0) + 1;

    this.save();
  }

  /**
   * =========================
   * SUCCESS TRACKING
   * =========================
   */
  logSuccess(step) {
    const key = step?.action || "unknown";

    this.state.successes[key] =
      (this.state.successes[key] || 0) + 1;

    this.save();
  }

  /**
   * =========================
   * INSIGHTS
   * =========================
   */
  getInsights() {
    return {
      mostFailingActions: this.state.failures,
      mostSuccessfulActions: this.state.successes,
      totalRuns: this.state.runs.length,
      signals: this.state.lastSignals,
    };
  }

  /**
   * =========================
   * SELF OPTIMIZATION SIGNALS
   * =========================
   */
  updateOptimizationSignals() {
    const f = this.state.failures;
    const s = this.state.successes;

    const signals = {
      biasInspect: 1,
      biasTest: 1,
      biasBuild: 1,
    };

    if ((s.inspect || 0) > (f.inspect || 0)) {
      signals.biasInspect += 0.5;
    }

    if ((f.inspect || 0) > (s.inspect || 0)) {
      signals.biasInspect = Math.max(0.2, signals.biasInspect - 0.3);
    }

    if ((f.run_tests || 0) > 1) {
      signals.biasTest -= 0.2;
      signals.biasInspect += 0.3;
    }

    if ((s.run_tests || 0) > (f.run_tests || 0)) {
      signals.biasTest += 0.3;
    }

    if ((f.build_project || 0) > (s.build_project || 0)) {
      signals.biasBuild = Math.max(0.2, signals.biasBuild - 0.4);
    }

    if ((s.build_project || 0) > (f.build_project || 0)) {
      signals.biasBuild += 0.3;
    }

    signals.biasInspect = Math.max(0.1, signals.biasInspect);
    signals.biasTest = Math.max(0.1, signals.biasTest);
    signals.biasBuild = Math.max(0.1, signals.biasBuild);

    this.state.lastSignals = signals;
    this.save();

    return signals;
  }
}

module.exports = ForgeMemory;
