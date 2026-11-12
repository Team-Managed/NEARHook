import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  DeliveryRecord,
  Network,
  StorageAdapter,
  StoredTerminalDAG,
  Subscription,
  SubscriptionStatus,
  YieldRecord,
} from "../types.js";

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a row array from Neon SQL");
  return value as Row[];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError("Expected a string database value");
}

function asNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError("Expected a safe integer database value");
  return number;
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value);
}

function parseSubscription(row: Row): Subscription {
  return {
    id: asString(row.id),
    account_id: asString(row.account_id),
    event_types: Array.isArray(row.event_types) ? row.event_types.map(asString) : [],
    destination_url: asString(row.destination_url),
    agent_safe: row.agent_safe === true,
    dust_threshold_usd: Number(row.dust_threshold_usd),
    status: asString(row.status) as SubscriptionStatus,
    consecutive_failures: asNumber(row.consecutive_failures),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
  };
}

function parseDelivery(row: Row): DeliveryRecord {
  return {
    id: asString(row.id),
    subscription_id: asString(row.subscription_id),
    tx_hash: asString(row.tx_hash),
    block_height: asNumber(row.block_height),
    protocol_status: asString(row.protocol_status),
    business_status: asString(row.business_status),
    payload: row.payload as DeliveryRecord["payload"],
    status: asString(row.status) as DeliveryRecord["status"],
    http_status: row.http_status === null ? null : asNumber(row.http_status),
    attempt_count: asNumber(row.attempt_count),
    latency_ms: row.latency_ms === null ? null : asNumber(row.latency_ms),
    response_body: asNullableString(row.response_body),
    created_at: asString(row.created_at),
    delivered_at: asNullableString(row.delivered_at),
  };
}

function parseYield(row: Row): YieldRecord {
  return {
    yield_token: asString(row.yield_token),
    request_id: asNumber(row.request_id),
    tx_hash: asString(row.tx_hash),
    contract_id: asString(row.contract_id),
    status: asString(row.status) as YieldRecord["status"],
    resume_payload: asNullableString(row.resume_payload),
    resume_tx_hash: asNullableString(row.resume_tx_hash),
    created_at_block: asNumber(row.created_at_block),
    expires_at_block: asNumber(row.expires_at_block),
    created_at: asString(row.created_at),
    resumed_at: asNullableString(row.resumed_at),
  };
}

const MIGRATION_FALLBACK = `
CREATE TABLE IF NOT EXISTS checkpoints (network TEXT PRIMARY KEY, last_block_height BIGINT NOT NULL CHECK (last_block_height >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, event_types TEXT[] NOT NULL DEFAULT ARRAY['settlement']::TEXT[], destination_url TEXT NOT NULL, agent_safe BOOLEAN NOT NULL DEFAULT FALSE, dust_threshold_usd NUMERIC(10,4) NOT NULL DEFAULT 1.0000, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED_MANUAL','PAUSED_UNHEALTHY')), consecutive_failures INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_subscriptions_active_account ON subscriptions (status, account_id);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE, tx_hash TEXT NOT NULL, block_height BIGINT NOT NULL, protocol_status TEXT NOT NULL, business_status TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','FAILED')), http_status SMALLINT, attempt_count SMALLINT NOT NULL DEFAULT 0, latency_ms INTEGER, response_body TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivered_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_deliveries_tx_hash ON deliveries (tx_hash);
CREATE INDEX IF NOT EXISTS idx_deliveries_subscription_created ON deliveries (subscription_id, created_at DESC);
CREATE TABLE IF NOT EXISTS terminal_dags (tx_hash TEXT PRIMARY KEY, block_height BIGINT NOT NULL, dag JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS two_way_yields (yield_token TEXT PRIMARY KEY, request_id BIGINT NOT NULL, tx_hash TEXT NOT NULL, contract_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AWAITING_WEBHOOK' CHECK (status IN ('AWAITING_WEBHOOK','RESUMING','RESUMED','EXPIRED')), resume_payload TEXT, resume_tx_hash TEXT, created_at_block BIGINT NOT NULL, expires_at_block BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resumed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_two_way_yields_status ON two_way_yields (status);
CREATE INDEX IF NOT EXISTS idx_two_way_yields_contract ON two_way_yields (contract_id);
`;

export class PostgresStorageAdapter implements StorageAdapter {
  private readonly sql: ReturnType<typeof neon>;

  public constructor(connectionString: string) {
    if (!connectionString) throw new Error("A PostgreSQL connection string is required");
    this.sql = neon(connectionString);
  }

  public async migrate(): Promise<void> {
    let schema = MIGRATION_FALLBACK;
    try {
      const sourceSchema = fileURLToPath(new URL("./schema.sql", import.meta.url));
      schema = await readFile(sourceSchema, "utf8");
    } catch {
      // Compiled distributions use the embedded migration when schema.sql is not copied.
    }
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
      await this.sql.query(statement, []);
    }
  }

  public async getCheckpoint(network: Network): Promise<number | null> {
    const rows = asRows(await this.sql.query(
      "SELECT last_block_height FROM checkpoints WHERE network = $1",
      [network]
    ));
    return rows[0] ? asNumber(rows[0].last_block_height) : null;
  }

  public async saveCheckpoint(network: Network, height: number): Promise<void> {
    await this.sql.query(
      "INSERT INTO checkpoints (network, last_block_height) VALUES ($1, $2) ON CONFLICT (network) DO UPDATE SET last_block_height = GREATEST(checkpoints.last_block_height, EXCLUDED.last_block_height), updated_at = NOW()",
      [network, height]
    );
  }

  public async putSubscription(subscription: Subscription): Promise<void> {
    await this.sql.query(
      "INSERT INTO subscriptions (id, account_id, event_types, destination_url, agent_safe, dust_threshold_usd, status, consecutive_failures, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET account_id=EXCLUDED.account_id, event_types=EXCLUDED.event_types, destination_url=EXCLUDED.destination_url, agent_safe=EXCLUDED.agent_safe, dust_threshold_usd=EXCLUDED.dust_threshold_usd, status=EXCLUDED.status, consecutive_failures=EXCLUDED.consecutive_failures, updated_at=NOW()",
      [subscription.id, subscription.account_id, subscription.event_types, subscription.destination_url,
        subscription.agent_safe, subscription.dust_threshold_usd, subscription.status,
        subscription.consecutive_failures, subscription.created_at, subscription.updated_at]
    );
  }

  public async getActiveSubscriptions(accountId: string): Promise<Subscription[]> {
    const rows = asRows(await this.sql.query(
      "SELECT * FROM subscriptions WHERE status='ACTIVE' AND (account_id=$1 OR account_id='*' OR (LEFT(account_id, 2)='*.' AND $1 LIKE '%' || SUBSTRING(account_id FROM 2)))",
      [accountId]
    ));
    return rows.map(parseSubscription);
  }

  public async updateSubscriptionHealth(
    id: string,
    consecutiveFailures: number,
    status: SubscriptionStatus
  ): Promise<void> {
    await this.sql.query(
      "UPDATE subscriptions SET consecutive_failures=$2, status=$3, updated_at=NOW() WHERE id=$1",
      [id, consecutiveFailures, status]
    );
  }

  public async saveTerminalDAG(record: StoredTerminalDAG): Promise<void> {
    const dag = {
      ...record.dag,
      nodes: Array.from(record.dag.nodes.entries()),
      spawned_receipt_ids: Array.from(record.dag.spawned_receipt_ids),
      executed_receipt_ids: Array.from(record.dag.executed_receipt_ids),
      pruned_gas_receipt_ids: Array.from(record.dag.pruned_gas_receipt_ids),
    };
    await this.sql.query(
      "INSERT INTO terminal_dags (tx_hash, block_height, dag, created_at) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (tx_hash) DO NOTHING",
      [record.tx_hash, record.block_height, JSON.stringify(dag), record.created_at]
    );
  }

  public async saveDelivery(record: DeliveryRecord): Promise<void> {
    await this.sql.query(
      "INSERT INTO deliveries (id, subscription_id, tx_hash, block_height, protocol_status, business_status, payload, status, http_status, attempt_count, latency_ms, response_body, created_at, delivered_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING",
      [record.id, record.subscription_id, record.tx_hash, record.block_height, record.protocol_status,
        record.business_status, JSON.stringify(record.payload), record.status, record.http_status,
        record.attempt_count, record.latency_ms, record.response_body, record.created_at, record.delivered_at]
    );
  }

  public async updateDelivery(record: DeliveryRecord): Promise<void> {
    await this.sql.query(
      "UPDATE deliveries SET status=$2, http_status=$3, attempt_count=$4, latency_ms=$5, response_body=$6, delivered_at=$7 WHERE id=$1",
      [record.id, record.status, record.http_status, record.attempt_count, record.latency_ms,
        record.response_body, record.delivered_at]
    );
  }

  public async getDelivery(id: string): Promise<DeliveryRecord | null> {
    const rows = asRows(await this.sql.query("SELECT * FROM deliveries WHERE id=$1", [id]));
    return rows[0] ? parseDelivery(rows[0]) : null;
  }

  public async listDeliveries(subscriptionId: string, limit: number): Promise<DeliveryRecord[]> {
    const rows = asRows(await this.sql.query(
      "SELECT * FROM deliveries WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT $2",
      [subscriptionId, Math.max(0, Math.trunc(limit))]
    ));
    return rows.map(parseDelivery);
  }

  public async saveYield(record: YieldRecord): Promise<void> {
    await this.sql.query(
      "INSERT INTO two_way_yields (yield_token, request_id, tx_hash, contract_id, status, resume_payload, resume_tx_hash, created_at_block, expires_at_block, created_at, resumed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (yield_token) DO NOTHING",
      [record.yield_token, record.request_id, record.tx_hash, record.contract_id, record.status,
        record.resume_payload, record.resume_tx_hash, record.created_at_block, record.expires_at_block,
        record.created_at, record.resumed_at]
    );
  }

  public async updateYield(record: YieldRecord): Promise<void> {
    await this.sql.query(
      "UPDATE two_way_yields SET status=$2, resume_payload=$3, resume_tx_hash=$4, resumed_at=$5 WHERE yield_token=$1",
      [record.yield_token, record.status, record.resume_payload, record.resume_tx_hash, record.resumed_at]
    );
  }

  public async getYield(yieldToken: string): Promise<YieldRecord | null> {
    const rows = asRows(await this.sql.query("SELECT * FROM two_way_yields WHERE yield_token=$1", [yieldToken]));
    return rows[0] ? parseYield(rows[0]) : null;
  }

  public async claimYieldForResume(yieldToken: string): Promise<YieldRecord | null> {
    const rows = asRows(await this.sql.query(
      "UPDATE two_way_yields SET status='RESUMING' WHERE yield_token=$1 AND status='AWAITING_WEBHOOK' RETURNING *",
      [yieldToken]
    ));
    return rows[0] ? parseYield(rows[0]) : null;
  }
}
