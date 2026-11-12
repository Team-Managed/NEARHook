import {
  type InFlightDAG,
  type ExecutionOutcomeNode,
  type SettlementResolution,
  type SettlementAmounts,
  type SettlementDetails,
} from "../types/domain.js";

export interface NEP141TransferContext {
  token_id: string;
  sender_id: string;
  receiver_id: string;
  amount: string;
  currency?: string;
}

/**
 * Inspects an InFlightDAG for NEP-141 ft_resolve_transfer callback outcomes
 * and extracts tri-state settlement status along with diagnostic details (ADR-009).
 */
export function evaluateNEP141Settlement(
  dag: InFlightDAG,
  context?: NEP141TransferContext
): SettlementResolution | null {
  let resolveNode: ExecutionOutcomeNode | undefined;
  let rootNode: ExecutionOutcomeNode | undefined;
  let panickedNode: ExecutionOutcomeNode | undefined;

  let totalGasBurnt = 0n;

  for (const [, node] of dag.nodes) {
    try {
      totalGasBurnt += BigInt(node.gas_burnt);
    } catch {
      // Ignore gas parse failure
    }

    if (node.receipt_id === dag.root_receipt_id) {
      rootNode = node;
    }

    // Check for intermediate panic
    if (node.status.type === "Failure") {
      panickedNode = node;
    }

    // Search logs for panic message even if caught by callback
    if (!panickedNode) {
      for (const log of node.logs) {
        if (log.toLowerCase().includes("panic") || log.toLowerCase().includes("error")) {
          panickedNode = node;
          break;
        }
      }
    }

    if (node.method_name === "ft_resolve_transfer") {
      resolveNode = node;
    }
  }

  // If this DAG does not contain ft_resolve_transfer, it's not a NEP-141 transfer call
  if (!resolveNode) {
    return null;
  }

  // Extract transferred amount from args or default
  let transferredAmount = "0";
  let currency = "UNKNOWN";

  if (context) {
    transferredAmount = context.amount;
    currency = context.currency ?? context.token_id;
  } else if (rootNode?.args_json && typeof rootNode.args_json["amount"] === "string") {
    transferredAmount = rootNode.args_json["amount"];
  } else if (resolveNode.args_json && typeof resolveNode.args_json["amount"] === "string") {
    transferredAmount = resolveNode.args_json["amount"];
  }

  if (!context && rootNode) {
    // The receiver is the token contract. Its account name is not necessarily a symbol.
    currency = rootNode.receiver_id;
  }

  // Parse raw return value from ft_resolve_transfer
  // Standard NEP-141 returns U128 (as string or quoted string) indicating the refunded amount
  let rawReturnValue = "0";
  if (resolveNode.status.type === "SuccessValue") {
    try {
      const decoded = Buffer.from(resolveNode.status.value, "base64").toString("utf-8");
      // JSON might return "100" or 100
      const parsed = JSON.parse(decoded);
      rawReturnValue = String(parsed);
    } catch {
      rawReturnValue = resolveNode.status.value || "0";
    }
  }

  const transferred = BigInt(transferredAmount || "0");
  let refunded = 0n;
  try {
    refunded = BigInt(rawReturnValue);
  } catch {
    refunded = 0n;
  }

  // Clamp refunded to transferred if greater
  if (transferred > 0n && refunded > transferred) {
    refunded = transferred;
  }

  const settled = transferred >= refunded ? transferred - refunded : 0n;

  // Classify business status
  let businessStatus: "CONFIRMED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "FAILED" = "CONFIRMED";
  let protocolStatus: "SUCCESS" | "FAILURE" = "SUCCESS";

  if (resolveNode.status.type === "Failure") {
    protocolStatus = "FAILURE";
    businessStatus = "FAILED";
  } else if (transferred > 0n && refunded === transferred) {
    businessStatus = "REFUNDED";
  } else if (refunded > 0n && settled > 0n) {
    businessStatus = "PARTIALLY_REFUNDED";
  } else {
    businessStatus = "CONFIRMED";
  }

  const amounts: SettlementAmounts = {
    transferred: transferred.toString(),
    settled: settled.toString(),
    refunded: refunded.toString(),
    currency,
  };

  let panicReason: string | undefined;
  if (panickedNode) {
    if (panickedNode.status.type === "Failure") {
      panicReason = panickedNode.status.error.error_message;
    } else {
      const panicLog = panickedNode.logs.find(
        (l) => l.toLowerCase().includes("panic") || l.toLowerCase().includes("error")
      );
      if (panicLog) {
        panicReason = panicLog;
      }
    }
  }

  const details: SettlementDetails = {
    resolver_method: "ft_resolve_transfer",
    raw_return_value: rawReturnValue,
    panicked_receipt_id: panickedNode ? panickedNode.receipt_id : undefined,
    panic_reason: panicReason,
    cross_shard_hops: dag.nodes.size,
    total_gas_burnt: totalGasBurnt.toString(),
    gas_pruned_win_ms: dag.pruned_gas_receipt_ids.size > 0 ? 600 : 0,
  };

  return {
    protocol_status: protocolStatus,
    business_status: businessStatus,
    amounts,
    details,
  };
}
