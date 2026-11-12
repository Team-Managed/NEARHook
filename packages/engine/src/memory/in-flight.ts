import type { InFlightDAG } from "@nearhook/core";

interface Entry {
  dag: InFlightDAG;
  expiresAt: number;
}

export class InFlightDAGStore {
  private readonly entries = new Map<string, Entry>();
  private sweepTimer: NodeJS.Timeout | null = null;

  public constructor(
    private readonly ttlMs = 120_000,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("TTL must be positive");
  }

  public get(txHash: string): InFlightDAG | undefined {
    const entry = this.entries.get(txHash);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(txHash);
      return undefined;
    }
    entry.expiresAt = this.now() + this.ttlMs;
    return entry.dag;
  }

  public set(txHash: string, dag: InFlightDAG): void {
    this.entries.set(txHash, { dag, expiresAt: this.now() + this.ttlMs });
  }

  public delete(txHash: string): void {
    this.entries.delete(txHash);
  }

  public get size(): number {
    this.sweep();
    return this.entries.size;
  }

  public values(): InFlightDAG[] {
    this.sweep();
    return Array.from(this.entries.values(), ({ dag }) => dag);
  }

  public sweep(): number {
    const now = this.now();
    let evicted = 0;
    for (const [txHash, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(txHash);
        evicted++;
      }
    }
    return evicted;
  }

  public startSweep(intervalMs = Math.max(1_000, Math.floor(this.ttlMs / 2))): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), intervalMs);
    this.sweepTimer.unref();
  }

  public stopSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}
