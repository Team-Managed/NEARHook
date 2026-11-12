import {
  type CanonicalWebhookPayload,
  type AgentSafePayload,
} from "@nearhook/core";

export interface TreeFormatOptions {
  noColor?: boolean;
  localUrl?: string;
  httpStatus?: number;
  latencyMs?: number;
}

function isAgentSafe(
  payload: CanonicalWebhookPayload | AgentSafePayload
): payload is AgentSafePayload {
  return "untrusted_metadata" in payload;
}

export function formatReceiptTree(
  payload: CanonicalWebhookPayload | AgentSafePayload,
  options: TreeFormatOptions = {}
): string {
  const useColor = !options.noColor;

  // ANSI Color codes mapped to NearHook brand palette (Spruce Green, Tangerine Orange, Bone White)
  const c = {
    reset: useColor ? "\x1b[0m" : "",
    bold: useColor ? "\x1b[1m" : "",
    dim: useColor ? "\x1b[90m" : "",
    green: useColor ? "\x1b[32m" : "",
    orange: useColor ? "\x1b[33m" : "",
    red: useColor ? "\x1b[31m" : "",
    cyan: useColor ? "\x1b[36m" : "",
    white: useColor ? "\x1b[37m" : "",
  };

  const lines: string[] = [];

  // 1. Header
  lines.push(
    `${c.bold}┌─ NEARHOOK EVENT [${payload.id}] ${"─".repeat(Math.max(10, 56 - payload.id.length))}${c.reset}`
  );
  const hops = payload.settlement.details.cross_shard_hops;
  const shardStr = hops > 1 ? `Shards: Shard 0 ➔ Shard ${hops - 1}` : "Single Shard (Shard 0)";
  lines.push(
    `${c.bold}│${c.reset} Tx: ${c.cyan}${payload.tx_hash}${c.reset}  ${c.dim}•${c.reset}  ${shardStr}`
  );

  // 2. Receipt Tree
  lines.push(`${c.bold}├─ RECEIPT TREE${c.reset}`);
  const sender = payload.route.sender;
  const recipient = payload.route.recipient;
  const isRefunded = payload.settlement.business_status === "REFUNDED" || payload.settlement.business_status === "PARTIALLY_REFUNDED";
  const panicReason = payload.settlement.details.panic_reason;

  lines.push(
    `${c.bold}│${c.reset}  ├── ${c.dim}[Shard 0]${c.reset} ${sender}::transfer ─────── ${c.green}✔ SUCCESS${c.reset}`
  );

  if (isRefunded) {
    const reasonStr = panicReason ? ` ✘ PANIC: "${panicReason}"` : " ✘ BUSINESS_CONDITION_UNMET";
    lines.push(
      `${c.bold}│${c.reset}  │   ├── ${c.dim}[Shard 1]${c.reset} ${recipient} ──────── ${c.red}${reasonStr}${c.reset}`
    );
    const refundPct = payload.settlement.business_status === "REFUNDED" ? "100%" : "PARTIAL";
    lines.push(
      `${c.bold}│${c.reset}  │   └── ${c.dim}[Shard 0]${c.reset} ${payload.settlement.details.resolver_method} ── ${c.orange}✔ REFUND ${refundPct}${c.reset}`
    );
  } else {
    lines.push(
      `${c.bold}│${c.reset}  │   └── ${c.dim}[Shard 1]${c.reset} ${recipient}::ft_on_transfer ──── ${c.green}✔ CONFIRMED${c.reset}`
    );
  }

  if (payload.settlement.details.gas_pruned_win_ms > 0) {
    lines.push(
      `${c.bold}│${c.reset}  └── ✂ ${c.orange}[Gas Refund] system ➔ ${sender} ───────────── [PRUNED -${payload.settlement.details.gas_pruned_win_ms}ms latency win]${c.reset}`
    );
  }

  // 3. Settlement
  lines.push(`${c.bold}├─ SETTLEMENT${c.reset}`);
  const protoColor = payload.settlement.protocol_status === "SUCCESS" ? c.green : c.red;
  lines.push(
    `${c.bold}│${c.reset}  • Protocol Status: ${protoColor}${payload.settlement.protocol_status}${c.reset}`
  );

  const bizColor = payload.settlement.business_status === "CONFIRMED" ? c.green : c.orange;
  const bizNote = isRefunded
    ? ` (${payload.settlement.amounts.refunded} ${payload.settlement.amounts.currency} returned to sender)`
    : "";
  lines.push(
    `${c.bold}│${c.reset}  • Business Status: ${bizColor}${payload.settlement.business_status}${bizNote}${c.reset}`
  );

  if (payload.omnichain) {
    lines.push(
      `${c.bold}│${c.reset}  • Omnichain Route: ${payload.omnichain.source_chain} ➔ ${payload.omnichain.destination_chain} (${payload.omnichain.amount_in} ${payload.omnichain.token_in})`
    );
  } else {
    lines.push(
      `${c.bold}│${c.reset}  • Route: ${payload.route.amount} ${payload.route.token} (${sender} ➔ ${recipient})`
    );
  }

  // 4. Agent-Safe Indicator
  if (isAgentSafe(payload)) {
    lines.push(`${c.bold}├─ AGENT-SAFE MODE 🛡️${c.reset}`);
    lines.push(
      `${c.bold}│${c.reset}  • Quarantined: memo isolated away from prompt (${payload.untrusted_metadata.warning})`
    );
  }

  // 5. Local Dispatch
  if (options.localUrl) {
    lines.push(`${c.bold}├─ LOCAL DISPATCH${c.reset}`);
    const statusText = options.httpStatus ?? 0;
    const okText = statusText >= 200 && statusText < 300 ? "OK" : "FAILED";
    const statusColor = statusText >= 200 && statusText < 300 ? c.green : c.red;
    const latencyStr = options.latencyMs !== undefined ? ` (${options.latencyMs}ms)` : "";
    lines.push(
      `${c.bold}│${c.reset}  ➔ POST ${options.localUrl} ── ${statusColor}${statusText} ${okText}${latencyStr}${c.reset}`
    );
  }

  lines.push(`${c.bold}└────────────────────────────────────────────────────────────────────${c.reset}`);

  return lines.join("\n");
}
