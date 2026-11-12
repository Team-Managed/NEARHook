import WebSocket from "ws";
import {
  type CanonicalWebhookPayload,
  type AgentSafePayload,
  sanitizeForAgent,
} from "@nearhook/core";
import { forwardPayload, type ForwardResult } from "../forwarder/http.js";
import { formatReceiptTree } from "../tui/tree.js";

export interface TunnelClientOptions {
  hubUrl: string;
  account: string;
  forwardUrl: string;
  agentSafe?: boolean | undefined;
  tokenUsdPrices?: Readonly<Record<string, number>> | undefined;
  secret?: string | undefined;
  reconnect?: boolean | undefined;
  maxReconnectAttempts?: number | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  logger?: ((msg: string) => void) | undefined;
  onConnect?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  onError?: ((err: Error) => void) | undefined;
  onEvent?: ((
    payload: CanonicalWebhookPayload | AgentSafePayload,
    result: ForwardResult
  ) => void) | undefined;
}

export type HubInboundMessage =
  | { type: "ping" }
  | { type: "event"; payload: CanonicalWebhookPayload; signature?: string | undefined }
  | { type: "subscribed"; account: string }
  | { type: "error"; message: string };

export class TunnelClient {
  private ws: WebSocket | null = null;
  private isClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public readonly options: {
    hubUrl: string;
    account: string;
    forwardUrl: string;
    agentSafe: boolean;
    tokenUsdPrices: Readonly<Record<string, number>>;
    reconnect: boolean;
    maxReconnectAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    logger: (msg: string) => void;
    secret?: string | undefined;
    onConnect?: (() => void) | undefined;
    onDisconnect?: (() => void) | undefined;
    onError?: ((err: Error) => void) | undefined;
    onEvent?: ((
      payload: CanonicalWebhookPayload | AgentSafePayload,
      result: ForwardResult
    ) => void) | undefined;
  };

  constructor(options: TunnelClientOptions) {
    this.options = {
      hubUrl: options.hubUrl,
      account: options.account,
      forwardUrl: options.forwardUrl,
      agentSafe: options.agentSafe ?? false,
      tokenUsdPrices: options.tokenUsdPrices ?? { USDC: 1, USDT: 1, NEAR: 5 },
      reconnect: options.reconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 50,
      initialDelayMs: options.initialDelayMs ?? 1000,
      maxDelayMs: options.maxDelayMs ?? 30000,
      logger: options.logger ?? ((msg: string) => console.log(msg)),
      secret: options.secret,
      onConnect: options.onConnect,
      onDisconnect: options.onDisconnect,
      onError: options.onError,
      onEvent: options.onEvent,
    };
  }

  public connect(): void {
    if (this.isClosed) return;

    const url = new URL(this.options.hubUrl);
    url.searchParams.set("account", this.options.account);

    this.options.logger(
      `[nearhook] Connecting to Tunnel Hub at ${url.protocol}//${url.host}${url.pathname}...`
    );

    this.ws = new WebSocket(url.toString());

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.options.logger(
        `[nearhook] Connected! Tunneling events for "${this.options.account}" ➔ ${this.options.forwardUrl}`
      );

      // Send subscription handshake
      const subscribeMsg = {
        type: "subscribe",
        account: this.options.account,
        agent_safe: this.options.agentSafe,
        ...(this.options.secret ? { secret: this.options.secret } : {}),
      };
      this.sendJson(subscribeMsg);

      this.options.onConnect?.();
    });

    this.ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const text = data.toString();
        const msg = JSON.parse(text) as HubInboundMessage;
        await this.handleMessage(msg);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.options.logger(`[nearhook] Error handling message: ${message}`);
      }
    });

    this.ws.on("error", (err: Error) => {
      this.options.logger(`[nearhook] WebSocket error: ${err.message}`);
      this.options.onError?.(err);
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      this.ws = null;
      this.options.onDisconnect?.();

      if (!this.isClosed && this.options.reconnect) {
        this.scheduleReconnect(code, reason.toString());
      }
    });
  }

  private async handleMessage(msg: HubInboundMessage): Promise<void> {
    if (msg.type === "ping") {
      this.sendJson({ type: "pong" });
      return;
    }

    if (msg.type === "subscribed") {
      this.options.logger(`[nearhook] Successfully subscribed to ${msg.account}`);
      return;
    }

    if (msg.type === "error") {
      this.options.logger(`[nearhook] Hub error: ${msg.message}`);
      return;
    }

    if (msg.type === "event") {
      await this.processEvent(msg.payload, msg.signature);
    }
  }

  public async processEvent(
    rawPayload: CanonicalWebhookPayload,
    signature?: string
  ): Promise<ForwardResult | null> {
    let payloadToForward: CanonicalWebhookPayload | AgentSafePayload = rawPayload;

    if (this.options.agentSafe) {
      const sanitized = sanitizeForAgent(rawPayload, {
        tokenUsdPrices: this.options.tokenUsdPrices,
      });
      if (!sanitized) {
        this.options.logger(
          `[nearhook] 🛡️  Agent-Safe: Dropped dust/invalid event ${rawPayload.id} (< $1.00 USD threshold).`
        );
        this.sendJson({ type: "ack", event_id: rawPayload.id });
        return null;
      }
      payloadToForward = sanitized;
    }

    const result = await forwardPayload(this.options.forwardUrl, payloadToForward, {
      signature,
    });

    // Render ASCII DAG Tree
    const treeOutput = formatReceiptTree(payloadToForward, {
      localUrl: this.options.forwardUrl,
      httpStatus: result.status,
      latencyMs: result.latencyMs,
    });
    this.options.logger("\n" + treeOutput + "\n");

    // Acknowledge receipt to the Hub
    this.sendJson({ type: "ack", event_id: rawPayload.id });

    this.options.onEvent?.(payloadToForward, result);
    return result;
  }

  private scheduleReconnect(code: number, reason: string): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.options.logger(
        `[nearhook] Max reconnection attempts (${this.options.maxReconnectAttempts}) reached. Terminating.`
      );
      return;
    }

    this.reconnectAttempts++;
    const jitter = Math.random() * 500;
    const backoff = Math.min(
      this.options.maxDelayMs,
      this.options.initialDelayMs * Math.pow(2, this.reconnectAttempts - 1) + jitter
    );
    const delaySeconds = (backoff / 1000).toFixed(1);

    this.options.logger(
      `[nearhook] Connection lost (code: ${code}${reason ? `, reason: ${reason}` : ""}). Reconnecting in ${delaySeconds}s (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoff);
  }

  public sendJson(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public close(): void {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }
}
