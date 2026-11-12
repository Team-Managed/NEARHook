import type {
  DeliveryRecord,
  Network,
  StorageAdapter,
  StoredTerminalDAG,
  Subscription,
  SubscriptionStatus,
  YieldRecord,
} from "../types.js";

function matchesAccount(pattern: string, accountId: string): boolean {
  if (pattern === "*" || pattern === accountId) return true;
  if (pattern.startsWith("*.")) return accountId.endsWith(pattern.slice(1));
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(accountId);
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly checkpoints = new Map<Network, number>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly terminalDags = new Map<string, StoredTerminalDAG>();
  private readonly deliveries = new Map<string, DeliveryRecord>();
  private readonly yields = new Map<string, YieldRecord>();

  public async migrate(): Promise<void> {}

  public async getCheckpoint(network: Network): Promise<number | null> {
    return this.checkpoints.get(network) ?? null;
  }

  public async saveCheckpoint(network: Network, height: number): Promise<void> {
    const current = this.checkpoints.get(network) ?? -1;
    if (height < current) throw new Error(`Checkpoint regression: ${height} < ${current}`);
    this.checkpoints.set(network, height);
  }

  public async putSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.id, structuredClone(subscription));
  }

  public async getActiveSubscriptions(accountId: string): Promise<Subscription[]> {
    return Array.from(this.subscriptions.values())
      .filter((subscription) =>
        subscription.status === "ACTIVE" && matchesAccount(subscription.account_id, accountId)
      )
      .map((subscription) => structuredClone(subscription));
  }

  public async updateSubscriptionHealth(
    id: string,
    consecutiveFailures: number,
    status: SubscriptionStatus
  ): Promise<void> {
    const current = this.subscriptions.get(id);
    if (!current) throw new Error(`Subscription not found: ${id}`);
    this.subscriptions.set(id, {
      ...current,
      consecutive_failures: consecutiveFailures,
      status,
      updated_at: new Date().toISOString(),
    });
  }

  public async saveTerminalDAG(record: StoredTerminalDAG): Promise<void> {
    this.terminalDags.set(record.tx_hash, structuredClone(record));
  }

  public async saveDelivery(record: DeliveryRecord): Promise<void> {
    if (this.deliveries.has(record.id)) return;
    this.deliveries.set(record.id, structuredClone(record));
  }

  public async updateDelivery(record: DeliveryRecord): Promise<void> {
    if (!this.deliveries.has(record.id)) throw new Error(`Delivery not found: ${record.id}`);
    this.deliveries.set(record.id, structuredClone(record));
  }

  public async getDelivery(id: string): Promise<DeliveryRecord | null> {
    const record = this.deliveries.get(id);
    return record ? structuredClone(record) : null;
  }

  public async listDeliveries(subscriptionId: string, limit: number): Promise<DeliveryRecord[]> {
    return Array.from(this.deliveries.values())
      .filter((record) => record.subscription_id === subscriptionId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, Math.max(0, limit))
      .map((record) => structuredClone(record));
  }

  public async saveYield(record: YieldRecord): Promise<void> {
    if (this.yields.has(record.yield_token)) return;
    this.yields.set(record.yield_token, structuredClone(record));
  }

  public async updateYield(record: YieldRecord): Promise<void> {
    if (!this.yields.has(record.yield_token)) throw new Error(`Yield not found: ${record.yield_token}`);
    this.yields.set(record.yield_token, structuredClone(record));
  }

  public async getYield(yieldToken: string): Promise<YieldRecord | null> {
    const record = this.yields.get(yieldToken);
    return record ? structuredClone(record) : null;
  }

  public async claimYieldForResume(yieldToken: string): Promise<YieldRecord | null> {
    const record = this.yields.get(yieldToken);
    if (!record || record.status !== "AWAITING_WEBHOOK") return null;
    const claimed = { ...record, status: "RESUMING" as const };
    this.yields.set(yieldToken, claimed);
    return structuredClone(claimed);
  }
}
