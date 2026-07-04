export class FinancialSnapshotRepository {
  constructor(initialSnapshots = []) {
    this.snapshots = [...initialSnapshots];
  }

  save(snapshot) {
    this.snapshots = [...this.snapshots, snapshot];
    return snapshot;
  }

  list() {
    return Object.freeze([...this.snapshots]);
  }

  findById(id) {
    return this.snapshots.find((snapshot) => snapshot.id === id) || null;
  }

  findLatest() {
    return this.snapshots[this.snapshots.length - 1] || null;
  }
}

Object.freeze(FinancialSnapshotRepository);
