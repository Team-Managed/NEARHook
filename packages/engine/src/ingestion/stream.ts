import {
  asAccountId,
  asReceiptId,
  asTxHash,
  createInFlightDAG,
  evaluateSettlement,
  extractOmnichainIntent,
  ingestReceiptOutcome,
  type CanonicalWebhookPayload,
  type ExecutionOutcomeNode,
  type InFlightDAG,
} from "@nearhook/core";
import { InFlightDAGStore } from "../memory/in-flight.js";
import { WebhookDispatcher } from "../dispatcher/webhook.js";
import type { Network, StorageAdapter, Subscription, YieldRecord } from "../types.js";
import { HttpBlockBackfiller } from "./backfill.js";
import { BlockGapDetector } from "./gap-detector.js";
import { processWebhookYieldApproval, type YieldResumeDriver } from "../relayer/yield-resume.js";

export interface IngestionStreamOptions {
  network: Network;
  source: HttpBlockBackfiller;
  storage: StorageAdapter;
  dispatcher: WebhookDispatcher;
  hotStore?: InFlightDAGStore;
  pollIntervalMs?: number;
  initialLookbackBlocks?: number;
  maxBlocksPerRun?: number;
  yieldResumeDriver?: YieldResumeDriver;
  getCurrentBlock?: () => Promise<number>;
  logger?: (message: string) => void;
}

function accountMatches(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === value) return true;
  if (pattern.startsWith("*.")) return value.endsWith(pattern.slice(1));
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function latestYieldEvent(logs: readonly string[]): Record<string, unknown> | null {
  for (const log of logs) {
    const prefixIndex = log.indexOf("EVENT_JSON:");
    if (prefixIndex < 0) continue;
    try {
      const event: unknown = JSON.parse(log.slice(prefixIndex + "EVENT_JSON:".length));
      if (event === null || typeof event !== "object") continue;
      const row = event as Record<string, unknown>;
      if (row.event !== "yield_created" || !Array.isArray(row.data)) continue;
      const data = row.data[0];
      if (data !== null && typeof data === "object") return data as Record<string, unknown>;
    } catch {
      // Ignore unrelated or malformed contract logs.
    }
  }
  return null;
}

function makePayload(dag: InFlightDAG): CanonicalWebhookPayload {
  const settlement = evaluateSettlement(dag);
  const root = dag.nodes.get(dag.root_receipt_id);
  const logs = Array.from(dag.nodes.values()).flatMap((node) => node.logs);
  const omnichain = extractOmnichainIntent(dag);
  return {
    id: `evt_${dag.tx_hash}`,
    event: "settlement",
    timestamp: Math.floor(Date.now() / 1000),
    tx_hash: dag.tx_hash,
    route: {
      sender: root?.predecessor_id ?? asAccountId("unknown.near"),
      recipient: root?.receiver_id ?? asAccountId("unknown.near"),
      token: settlement.amounts.currency,
      amount: settlement.amounts.transferred,
    },
    settlement,
    ...(omnichain ? {
      omnichain: {
        source_chain: omnichain.source_chain,
        destination_chain: omnichain.destination_chain,
        token_in: omnichain.token_in,
        token_out: omnichain.token_out,
        amount_in: omnichain.amount_in_formatted,
        amount_out: omnichain.amount_out_formatted,
        ...(omnichain.relayer ? { relayer: omnichain.relayer } : {}),
      },
    } : {}),
    logs,
  };
}

export class IngestionStreamWorker {
  private readonly hotStore: InFlightDAGStore;
  private readonly pollIntervalMs: number;
  private readonly initialLookbackBlocks: number;
  private readonly maxBlocksPerRun: number;
  private readonly logger: (message: string) => void;
  private checkpoint = 0;
  private nextHeight: number | null = null;
  private running = false;
  private inRun = false;
  private timer: NodeJS.Timeout | null = null;

  public constructor(private readonly options: IngestionStreamOptions) {
    this.hotStore = options.hotStore ?? new InFlightDAGStore(120_000);
    this.pollIntervalMs = options.pollIntervalMs ?? 600;
    this.initialLookbackBlocks = options.initialLookbackBlocks ?? 5;
    this.maxBlocksPerRun = options.maxBlocksPerRun ?? 100;
    this.logger = options.logger ?? console.log;
  }

  public async initialize(signal?: AbortSignal): Promise<void> {
    const savedCheckpoint = await this.options.storage.getCheckpoint(this.options.network);
    if (savedCheckpoint !== null) {
      this.checkpoint = savedCheckpoint;
      this.nextHeight = savedCheckpoint + 1;
      return;
    }
    const latestHeight = await this.options.source.getLatestHeight(signal);
    this.checkpoint = Math.max(0, latestHeight - this.initialLookbackBlocks - 1);
    this.nextHeight = this.checkpoint + 1;
    await this.options.storage.saveCheckpoint(this.options.network, this.checkpoint);
  }

  public async runOnce(signal?: AbortSignal): Promise<number> {
    if (this.inRun) return 0;
    this.inRun = true;
    try {
      if (this.nextHeight === null) await this.initialize(signal);
      const latestHeight = await this.options.source.getLatestHeight(signal);
      const firstHeight = this.nextHeight ?? latestHeight;
      const lastHeight = Math.min(latestHeight, firstHeight + this.maxBlocksPerRun - 1);
      if (lastHeight < firstHeight) return 0;

      const gapDetector = new BlockGapDetector(this.checkpoint);
      const gap = gapDetector.inspect(lastHeight);
      if (gap) this.logger(`[engine] Backfilling ${gap.missingHeights.length} contiguous blocks after ${this.checkpoint}`);
      const blocks = await this.options.source.backfill(firstHeight, lastHeight, signal);
      let processed = 0;
      for (const block of blocks) {
        if (signal?.aborted) throw signal.reason ?? new Error("Ingestion was aborted");
        await this.processBlock(block.height, block.outcomes);
        this.nextHeight = block.height + 1;
        await this.advanceCheckpoint(block.height);
        processed++;
      }
      return processed;
    } finally {
      this.inRun = false;
    }
  }

  public async start(signal?: AbortSignal): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.hotStore.startSweep();
    const loop = async (): Promise<void> => {
      if (!this.running || signal?.aborted) return;
      try {
        await this.runOnce(signal);
      } catch (error: unknown) {
        this.logger(`[engine] Ingestion error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.running && !signal?.aborted) {
        this.timer = setTimeout(() => void loop(), this.pollIntervalMs);
        this.timer.unref?.();
      }
    };
    await loop();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hotStore.stopSweep();
  }

  private async processBlock(blockHeight: number, outcomes: ExecutionOutcomeNode[]): Promise<void> {
    for (const outcome of outcomes) {
      let dag = this.hotStore.get(outcome.tx_hash);
      if (!dag) dag = createInFlightDAG(outcome.tx_hash, outcome.receipt_id);
      const transition = ingestReceiptOutcome(dag, outcome);
      const yieldEvent = latestYieldEvent(outcome.logs);
      if (yieldEvent) {
        const record = await this.storeYieldEvent(outcome, yieldEvent, blockHeight);
        if (record) await this.dispatchYieldRequest(outcome, yieldEvent, record, blockHeight);
      }

      if (transition.is_complete) {
        const completedDag = transition.dag;
        await this.options.storage.saveTerminalDAG({
          tx_hash: completedDag.tx_hash,
          block_height: blockHeight,
          dag: completedDag,
          created_at: new Date().toISOString(),
        });
        await this.dispatchSettlement(completedDag, blockHeight);
        this.hotStore.delete(outcome.tx_hash);
      } else {
        this.hotStore.set(outcome.tx_hash, transition.dag);
      }
    }
  }

  private async storeYieldEvent(
    outcome: ExecutionOutcomeNode,
    eventData: Record<string, unknown>,
    blockHeight: number
  ): Promise<YieldRecord | null> {
    const yieldToken = typeof eventData.yield_token === "string" ? eventData.yield_token : "";
    const requestId = Number(eventData.request_id);
    if (!yieldToken || !Number.isSafeInteger(requestId) || requestId < 0) {
      this.logger(`[engine] Ignored malformed yield_created event in ${outcome.tx_hash}`);
      return null;
    }
    const record: YieldRecord = {
      yield_token: yieldToken,
      request_id: requestId,
      tx_hash: outcome.tx_hash,
      contract_id: outcome.receiver_id,
      status: "AWAITING_WEBHOOK",
      resume_payload: null,
      resume_tx_hash: null,
      created_at_block: blockHeight,
      expires_at_block: blockHeight + 200,
      created_at: new Date().toISOString(),
      resumed_at: null,
    };
    await this.options.storage.saveYield(record);
    return await this.options.storage.getYield(yieldToken) ?? record;
  }

  private async dispatchYieldRequest(
    outcome: ExecutionOutcomeNode,
    eventData: Record<string, unknown>,
    record: YieldRecord,
    blockHeight: number
  ): Promise<void> {
    if (record.status !== "AWAITING_WEBHOOK") return;
    const actionId = typeof eventData.action_id === "string" ? eventData.action_id : "";
    const requesterId = typeof eventData.requester_id === "string"
      ? eventData.requester_id
      : outcome.predecessor_id;
    const payload = {
      id: `evt_yield_${record.yield_token}`,
      event: "two_way.requested" as const,
      timestamp: Math.floor(Date.now() / 1000),
      tx_hash: record.tx_hash,
      contract_id: record.contract_id,
      requester_id: requesterId,
      request_id: record.request_id,
      action_id: actionId,
      yield_token: record.yield_token,
    };
    const subscriptions = await this.options.storage.getActiveSubscriptions(record.contract_id);
    for (const subscription of subscriptions) {
      if (!subscription.event_types.includes("*") && !subscription.event_types.includes(payload.event)) continue;
      const result = await this.options.dispatcher.dispatch(subscription, payload, blockHeight);
      if (!result.delivery || !this.options.yieldResumeDriver) continue;
      const status = result.delivery.http_status;
      const responseBody = result.delivery.response_body;
      if (status === null || status < 200 || status >= 300 || responseBody === null) continue;
      const currentBlock = await (this.options.getCurrentBlock?.() ?? Promise.resolve(blockHeight));
      try {
        await processWebhookYieldApproval(record.yield_token, responseBody, {
          storage: this.options.storage,
          driver: this.options.yieldResumeDriver,
          currentBlock,
          httpStatus: status,
        });
      } catch (error: unknown) {
        this.logger(`[engine] Yield resume failed for ${record.yield_token}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async dispatchSettlement(dag: InFlightDAG, blockHeight: number): Promise<void> {
    const payload = makePayload(dag);
    const targetAccounts = new Set([payload.route.recipient, payload.route.sender]);
    const subscriptions = new Map<string, Subscription>();
    for (const account of targetAccounts) {
      for (const subscription of await this.options.storage.getActiveSubscriptions(account)) {
        subscriptions.set(subscription.id, subscription);
      }
    }
    for (const subscription of subscriptions.values()) {
      if (!subscription.event_types.includes("*") && !subscription.event_types.includes(payload.event)) continue;
      const result = await this.options.dispatcher.dispatch(subscription, payload, blockHeight);
      if (result.reason === "filtered") this.logger(`[engine] Agent-Safe filtered event ${payload.id} for ${subscription.id}`);
    }
  }

  private async advanceCheckpoint(processedHeight: number): Promise<void> {
    const pendingRootHeights = this.hotStore.values()
      .map((dag) => dag.nodes.get(dag.root_receipt_id)?.block_height)
      .filter((height): height is number => height !== undefined);
    const oldestPendingHeight = pendingRootHeights.length > 0 ? Math.min(...pendingRootHeights) : null;
    const safeHeight = oldestPendingHeight === null
      ? processedHeight
      : Math.min(processedHeight, oldestPendingHeight - 1);
    if (safeHeight > this.checkpoint) {
      await this.options.storage.saveCheckpoint(this.options.network, safeHeight);
      this.checkpoint = safeHeight;
    }
  }
}

export function isMatchingSubscription(subscription: Subscription, accountId: string): boolean {
  return accountMatches(subscription.account_id, accountId);
}

export function makeTransactionRootNode(
  txHash: string,
  receiptId: string,
  signerId: string,
  receiverId: string,
  blockHeight: number,
  shardId: number
): ExecutionOutcomeNode {
  return {
    tx_hash: asTxHash(txHash),
    receipt_id: asReceiptId(receiptId),
    predecessor_id: asAccountId(signerId),
    receiver_id: asAccountId(receiverId),
    block_height: blockHeight,
    shard_id: shardId,
    status: { type: "SuccessValue", value: "" },
    gas_burnt: "0",
    tokens_burnt: "0",
    logs: [],
    child_receipt_ids: [],
  };
}
