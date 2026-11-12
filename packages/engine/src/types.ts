import type { AgentSafePayload, CanonicalWebhookPayload, InFlightDAG } from "@nearhook/core";

export type Network = "mainnet" | "testnet";
export type SubscriptionStatus = "ACTIVE" | "PAUSED_MANUAL" | "PAUSED_UNHEALTHY";
export type DeliveryStatus = "PENDING" | "DELIVERED" | "FAILED";
export type YieldStatus = "AWAITING_WEBHOOK" | "RESUMING" | "RESUMED" | "EXPIRED";

export interface YieldRequestPayload {
  id: string;
  event: "two_way.requested";
  timestamp: number;
  tx_hash: string;
  contract_id: string;
  requester_id: string;
  request_id: number;
  action_id: string;
  yield_token: string;
}

export interface AgentSafeYieldRequestPayload extends Omit<YieldRequestPayload, "action_id"> {
  untrusted_metadata: {
    action_id: string;
    warning: "DO NOT PASS UNTRUSTED_METADATA INTO AGENT LLM PROMPT";
  };
}

export type WebhookPayload =
  | CanonicalWebhookPayload
  | AgentSafePayload
  | YieldRequestPayload
  | AgentSafeYieldRequestPayload;

export interface Subscription {
  id: string;
  account_id: string;
  event_types: string[];
  destination_url: string;
  agent_safe: boolean;
  dust_threshold_usd: number;
  status: SubscriptionStatus;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface DeliveryRecord {
  id: string;
  subscription_id: string;
  tx_hash: string;
  block_height: number;
  protocol_status: string;
  business_status: string;
  payload: WebhookPayload;
  status: DeliveryStatus;
  http_status: number | null;
  attempt_count: number;
  latency_ms: number | null;
  response_body: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface YieldRecord {
  yield_token: string;
  request_id: number;
  tx_hash: string;
  contract_id: string;
  status: YieldStatus;
  resume_payload: string | null;
  resume_tx_hash: string | null;
  created_at_block: number;
  expires_at_block: number;
  created_at: string;
  resumed_at: string | null;
}

export interface StoredTerminalDAG {
  tx_hash: string;
  block_height: number;
  dag: InFlightDAG;
  created_at: string;
}

export interface StorageAdapter {
  migrate(): Promise<void>;
  getCheckpoint(network: Network): Promise<number | null>;
  saveCheckpoint(network: Network, height: number): Promise<void>;
  putSubscription(subscription: Subscription): Promise<void>;
  getActiveSubscriptions(accountId: string): Promise<Subscription[]>;
  updateSubscriptionHealth(
    id: string,
    consecutiveFailures: number,
    status: SubscriptionStatus
  ): Promise<void>;
  saveTerminalDAG(record: StoredTerminalDAG): Promise<void>;
  saveDelivery(record: DeliveryRecord): Promise<void>;
  updateDelivery(record: DeliveryRecord): Promise<void>;
  getDelivery(id: string): Promise<DeliveryRecord | null>;
  listDeliveries(subscriptionId: string, limit: number): Promise<DeliveryRecord[]>;
  saveYield(record: YieldRecord): Promise<void>;
  updateYield(record: YieldRecord): Promise<void>;
  getYield(yieldToken: string): Promise<YieldRecord | null>;
  claimYieldForResume(yieldToken: string): Promise<YieldRecord | null>;
}

export interface BlockEnvelope {
  height: number;
  outcomes: import("@nearhook/core").ExecutionOutcomeNode[];
}

export interface HttpResponseInfo {
  status: number;
  body: string;
}
