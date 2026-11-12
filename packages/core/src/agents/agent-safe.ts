import {
  AgentSafePayloadSchema,
  CanonicalWebhookPayloadSchema,
  type AgentSafePayload,
  type CanonicalWebhookPayload,
} from "../types/domain.js";

export type AgentPayload = AgentSafePayload;

export interface AgentSafeOptions {
  /** USD value of one whole token, keyed by its case-insensitive symbol. */
  tokenUsdPrices?: Readonly<Record<string, number>>;
  /** Defaults to 1 USD. Payload route.amount must be human-readable token units. */
  minimumUsdValue?: number;
  /** Explicitly allow listed event IDs even if their value is below threshold or unknown. */
  whitelistedEventIds?: ReadonlySet<string>;
}

const WARNING = "DO NOT PASS UNTRUSTED_METADATA INTO AGENT LLM PROMPT" as const;

function parseHumanTokenAmount(amount: string, token: string): number | undefined {
  const match = amount.trim().match(/^(\d+(?:\.\d*)?|\.\d+)(?:\s+([A-Za-z0-9._-]+))?$/);
  if (!match || (match[2] !== undefined && match[2].toUpperCase() !== token.toUpperCase())) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Quarantines memos and logs and drops events below the USD threshold.
 * Without a trusted price for the payload token, the event is dropped unless
 * explicitly whitelisted; this keeps the core independent of stale price data.
 */
export function sanitizeForAgent(
  payload: CanonicalWebhookPayload,
  options: AgentSafeOptions = {}
): AgentPayload | null {
  const parsed = CanonicalWebhookPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;

  const minimumUsdValue = options.minimumUsdValue ?? 1;
  if (!Number.isFinite(minimumUsdValue) || minimumUsdValue < 0) return null;

  const isWhitelisted = options.whitelistedEventIds?.has(parsed.data.id) ?? false;
  if (!isWhitelisted) {
    const token = parsed.data.route.token.toUpperCase();
    const tokenUsdPrice = options.tokenUsdPrices?.[token];
    const amount = parseHumanTokenAmount(parsed.data.route.amount, token);
    if (
      tokenUsdPrice === undefined ||
      !Number.isFinite(tokenUsdPrice) ||
      tokenUsdPrice <= 0 ||
      amount === undefined ||
      amount * tokenUsdPrice < minimumUsdValue
    ) {
      return null;
    }
  }

  const untrustedStrings = [
    parsed.data.route.memo,
    ...parsed.data.logs,
    parsed.data.settlement.details.panic_reason,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const memo = untrustedStrings.length > 0 ? untrustedStrings.join("\n") : null;

  const safePayload = {
    id: parsed.data.id,
    event: parsed.data.event,
    timestamp: parsed.data.timestamp,
    tx_hash: parsed.data.tx_hash,
    route: {
      sender: parsed.data.route.sender,
      recipient: parsed.data.route.recipient,
      token: parsed.data.route.token,
      amount: parsed.data.route.amount,
      ...(parsed.data.route.destination_address === undefined
        ? {}
        : { destination_address: parsed.data.route.destination_address }),
    },
    settlement: {
      ...parsed.data.settlement,
      details: {
        ...parsed.data.settlement.details,
        panic_reason: undefined,
      },
    },
    ...(parsed.data.omnichain === undefined ? {} : { omnichain: parsed.data.omnichain }),
    untrusted_metadata: {
      memo,
      raw_memo: memo,
      warning: WARNING,
    },
  };

  const validated = AgentSafePayloadSchema.safeParse(safePayload);
  return validated.success ? validated.data : null;
}
