import {
  type CanonicalWebhookPayload,
  type AgentSafePayload,
  type InFlightDAG,
  type ExecutionOutcomeNode,
  asAccountId,
  createInFlightDAG,
  ingestReceiptOutcome,
  evaluateSettlement,
  sanitizeForAgent,
} from "@nearhook/core";
import { forwardPayload, type ForwardResult } from "../forwarder/http.js";
import { formatReceiptTree } from "../tui/tree.js";

export interface StandaloneListenerOptions {
  account: string;
  forwardUrl: string;
  agentSafe?: boolean | undefined;
  tokenUsdPrices?: Readonly<Record<string, number>> | undefined;
  fastnearUrl?: string | undefined;
  pollIntervalMs?: number | undefined;
  logger?: ((msg: string) => void) | undefined;
  onEvent?: ((
    payload: CanonicalWebhookPayload | AgentSafePayload,
    result: ForwardResult
  ) => void) | undefined;
}

export function matchesAccount(pattern: string, accountId: string): boolean {
  if (pattern === "*" || pattern === accountId) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // e.g. ".near"
    return accountId.endsWith(suffix);
  }
  const regexPattern = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
  return new RegExp(regexPattern).test(accountId);
}

export class StandaloneListener {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private currentHeight: number | null = null;
  private activeDAGs = new Map<string, InFlightDAG>();

  public readonly options: {
    account: string;
    forwardUrl: string;
    agentSafe: boolean;
    tokenUsdPrices: Readonly<Record<string, number>>;
    fastnearUrl: string;
    pollIntervalMs: number;
    logger: (msg: string) => void;
    onEvent?: ((
      payload: CanonicalWebhookPayload | AgentSafePayload,
      result: ForwardResult
    ) => void) | undefined;
  };

  constructor(options: StandaloneListenerOptions) {
    this.options = {
      account: options.account,
      forwardUrl: options.forwardUrl,
      agentSafe: options.agentSafe ?? false,
      tokenUsdPrices: options.tokenUsdPrices ?? { USDC: 1, USDT: 1, NEAR: 5 },
      fastnearUrl: options.fastnearUrl ?? "https://api.fastnear.com/v0",
      pollIntervalMs: options.pollIntervalMs ?? 600,
      logger: options.logger ?? ((msg: string) => console.log(msg)),
      onEvent: options.onEvent,
    };
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    this.options.logger(
      `[nearhook] Starting standalone listener (direct FastNEAR polling) for "${this.options.account}"...`
    );

    await this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.pollOnce();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.logger(`[nearhook] Polling error: ${message}`);
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.pollLoop(), this.options.pollIntervalMs);
    }
  }

  public async pollOnce(): Promise<void> {
    if (this.currentHeight === null) {
      this.currentHeight = await this.fetchLatestBlockHeight();
      this.options.logger(`[nearhook] Initialized at block height #${this.currentHeight}`);
      return;
    }

    const latest = await this.fetchLatestBlockHeight();
    if (latest === null) return;

    while (this.currentHeight <= latest && this.isRunning) {
      const outcomes = await this.fetchBlockOutcomes(this.currentHeight);
      for (const outcome of outcomes) {
        await this.processRawOutcome(outcome);
      }
      this.currentHeight++;
    }
  }

  public async processRawOutcome(outcome: ExecutionOutcomeNode): Promise<ForwardResult | null> {
    const isTarget =
      matchesAccount(this.options.account, outcome.receiver_id) ||
      matchesAccount(this.options.account, outcome.predecessor_id);

    if (!isTarget && !this.activeDAGs.has(outcome.tx_hash)) {
      return null;
    }

    let dag = this.activeDAGs.get(outcome.tx_hash);
    if (!dag) {
      dag = createInFlightDAG(outcome.tx_hash, outcome.receipt_id);
      this.activeDAGs.set(outcome.tx_hash, dag);
    }

    const transition = ingestReceiptOutcome(dag, outcome);
    this.activeDAGs.set(outcome.tx_hash, transition.dag);

    if (transition.is_complete) {
      this.activeDAGs.delete(outcome.tx_hash);
      return await this.dispatchCompletedDAG(transition.dag);
    }

    return null;
  }

  public async dispatchCompletedDAG(dag: InFlightDAG): Promise<ForwardResult | null> {
    const settlement = evaluateSettlement(dag);
    const rootNode = dag.nodes.get(dag.root_receipt_id);
    const allLogs = Array.from(dag.nodes.values()).flatMap((n) => n.logs);

    const rawPayload: CanonicalWebhookPayload = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      event: "settlement",
      timestamp: Math.floor(Date.now() / 1000),
      tx_hash: dag.tx_hash,
      route: {
        sender: rootNode ? rootNode.predecessor_id : asAccountId("unknown.near"),
        recipient: rootNode ? rootNode.receiver_id : asAccountId("unknown.near"),
        token: settlement.amounts.currency,
        amount: settlement.amounts.transferred,
      },
      settlement,
      logs: allLogs,
    };

    let payloadToForward: CanonicalWebhookPayload | AgentSafePayload = rawPayload;

    if (this.options.agentSafe) {
      const sanitized = sanitizeForAgent(rawPayload, {
        tokenUsdPrices: this.options.tokenUsdPrices,
      });
      if (!sanitized) {
        this.options.logger(
          `[nearhook] 🛡️  Agent-Safe: Dropped dust event ${rawPayload.id} (< $1.00 USD threshold).`
        );
        return null;
      }
      payloadToForward = sanitized;
    }

    const result = await forwardPayload(this.options.forwardUrl, payloadToForward);

    const treeOutput = formatReceiptTree(payloadToForward, {
      localUrl: this.options.forwardUrl,
      httpStatus: result.status,
      latencyMs: result.latencyMs,
    });
    this.options.logger("\n" + treeOutput + "\n");

    this.options.onEvent?.(payloadToForward, result);
    return result;
  }

  private async fetchLatestBlockHeight(): Promise<number | null> {
    try {
      const res = await fetch(`${this.options.fastnearUrl}/last_block/optimistic`);
      if (!res.ok) return null;
      const data = (await res.json()) as { block?: { header?: { height?: number } }; height?: number };
      const height = data.height ?? data.block?.header?.height;
      return typeof height === "number" ? height : null;
    } catch {
      return null;
    }
  }

  private async fetchBlockOutcomes(height: number): Promise<ExecutionOutcomeNode[]> {
    try {
      const res = await fetch(`${this.options.fastnearUrl}/block_opt/${height}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { outcomes?: ExecutionOutcomeNode[] };
      return Array.isArray(data.outcomes) ? data.outcomes : [];
    } catch {
      return [];
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.activeDAGs.clear();
  }
}
