import {
  sanitizeForAgent,
  signPayload,
  type AgentSafePayload,
} from "@nearhook/core";
import { CircuitBreaker } from "./circuit-breaker.js";
import { DelayedRetryQueue } from "./queue.js";
import type {
  AgentSafeYieldRequestPayload,
  DeliveryRecord,
  StorageAdapter,
  Subscription,
  WebhookPayload,
} from "../types.js";

export interface DispatcherOptions {
  storage: StorageAdapter;
  signingKey: string;
  tokenUsdPrices?: Readonly<Record<string, number>>;
  fetcher?: typeof fetch;
  retryQueue?: DelayedRetryQueue;
  circuitBreaker?: CircuitBreaker;
  now?: () => Date;
  maxResponseBodyBytes?: number;
}

export interface DispatchResult {
  delivery: DeliveryRecord | null;
  reason?: "filtered" | "circuit_open";
}

export class WebhookDispatcher {
  private readonly fetcher: typeof fetch;
  private readonly retryQueue: DelayedRetryQueue;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly now: () => Date;
  private readonly maxResponseBodyBytes: number;

  public constructor(private readonly options: DispatcherOptions) {
    if (!options.signingKey) throw new Error("An Ed25519 webhook signing key is required");
    this.fetcher = options.fetcher ?? fetch;
    this.retryQueue = options.retryQueue ?? new DelayedRetryQueue();
    this.circuitBreaker = options.circuitBreaker ?? new CircuitBreaker();
    this.now = options.now ?? (() => new Date());
    this.maxResponseBodyBytes = options.maxResponseBodyBytes ?? 4_096;
  }

  public async dispatch(
    subscription: Subscription,
    payload: WebhookPayload,
    blockHeight: number,
    signal?: AbortSignal
  ): Promise<DispatchResult> {
    if (subscription.status !== "ACTIVE") return { delivery: null, reason: "circuit_open" };

    let safePayload: WebhookPayload = payload;
    if (subscription.agent_safe) {
      if ("settlement" in payload) {
        if ("untrusted_metadata" in payload) {
          safePayload = payload;
        } else {
          const sanitized = sanitizeForAgent(payload, {
            ...(this.options.tokenUsdPrices ? { tokenUsdPrices: this.options.tokenUsdPrices } : {}),
            minimumUsdValue: subscription.dust_threshold_usd,
          });
          if (!sanitized) return { delivery: null, reason: "filtered" };
          safePayload = sanitized;
        }
      } else {
        if ("untrusted_metadata" in payload) {
          safePayload = payload;
          return this.deliver(subscription, payload, safePayload, blockHeight, signal);
        }
        const sanitized: AgentSafeYieldRequestPayload = {
          id: payload.id,
          event: payload.event,
          timestamp: payload.timestamp,
          tx_hash: payload.tx_hash,
          contract_id: payload.contract_id,
          requester_id: payload.requester_id,
          request_id: payload.request_id,
          yield_token: payload.yield_token,
          untrusted_metadata: {
            action_id: payload.action_id,
            warning: "DO NOT PASS UNTRUSTED_METADATA INTO AGENT LLM PROMPT",
          },
        };
        safePayload = sanitized;
      }
    }

    return this.deliver(subscription, payload, safePayload, blockHeight, signal);
  }

  private async deliver(
    subscription: Subscription,
    payload: WebhookPayload,
    safePayload: WebhookPayload,
    blockHeight: number,
    signal?: AbortSignal
  ): Promise<DispatchResult> {
    const id = `dlv_${subscription.id}_${payload.id}`;
    const existing = await this.options.storage.getDelivery(id);
    if (existing?.status === "DELIVERED") return { delivery: existing };
    const createdAt = this.now().toISOString();
    const settlement = "settlement" in payload ? payload.settlement : null;
    const delivery: DeliveryRecord = {
      id,
      subscription_id: subscription.id,
      tx_hash: payload.tx_hash,
      block_height: blockHeight,
      protocol_status: settlement?.protocol_status ?? "N/A",
      business_status: settlement?.business_status ?? "AWAITING_WEBHOOK",
      payload: safePayload,
      status: "PENDING",
      http_status: null,
      attempt_count: 0,
      latency_ms: null,
      response_body: null,
      created_at: createdAt,
      delivered_at: null,
    };
    await this.options.storage.saveDelivery(delivery);

    const result = await this.retryQueue.run(
      async (attempt) => this.post(subscription.destination_url, safePayload, attempt, signal),
      (response) => response.status >= 200 && response.status < 300,
      async (response, attempt) => {
        delivery.status = "PENDING";
        delivery.http_status = response.status;
        delivery.response_body = response.body;
        delivery.attempt_count = attempt;
        delivery.latency_ms = response.latencyMs;
        await this.options.storage.updateDelivery(delivery);
        return true;
      },
      signal
    );

    delivery.http_status = result.value.status;
    delivery.response_body = result.value.body;
    delivery.attempt_count = result.attempt;
    delivery.latency_ms = result.value.latencyMs;
    if (result.value.status >= 200 && result.value.status < 300) {
      delivery.status = "DELIVERED";
      delivery.delivered_at = this.now().toISOString();
      await this.options.storage.updateDelivery(delivery);
      await this.options.storage.updateSubscriptionHealth(subscription.id, 0, "ACTIVE");
      return { delivery };
    }
    delivery.status = "FAILED";
    await this.options.storage.updateDelivery(delivery);
    const consecutiveFailures = this.circuitBreaker.recordFailure(
      subscription.consecutive_failures
    ).consecutiveFailures;
    await this.options.storage.updateSubscriptionHealth(
      subscription.id,
      consecutiveFailures,
      consecutiveFailures >= 10 ? "PAUSED_UNHEALTHY" : "ACTIVE"
    );
    return { delivery };
  }

  private async post(
    destinationUrl: string,
    payload: WebhookPayload,
    attempt: number,
    signal?: AbortSignal
  ): Promise<{ status: number; body: string; latencyMs: number }> {
    const attestation = signPayload(payload, this.options.signingKey);
    const startedAt = performance.now();
    try {
      const parsedUrl = new URL(destinationUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
        return { status: 0, body: "Webhook destinations must use HTTPS (HTTP is allowed only for localhost)", latencyMs: 0 };
      }
      const response = await this.fetcher(destinationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NearHook-Id": payload.id,
          "X-NearHook-Timestamp": attestation.timestamp,
          "X-NearHook-Signature": attestation.signature,
          "X-NearHook-Delivery-Attempt": String(attempt),
        },
        body: attestation.canonical_payload,
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
      const body = (await response.text()).slice(0, this.maxResponseBodyBytes);
      return { status: response.status, body, latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error: unknown) {
      return {
        status: 0,
        body: error instanceof Error ? error.message.slice(0, this.maxResponseBodyBytes) : String(error),
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}

export type AgentWebhookPayload = AgentSafePayload;
