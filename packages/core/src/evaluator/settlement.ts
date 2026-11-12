import {
  type InFlightDAG,
  type SettlementResolution,
  type SettlementAmounts,
  type SettlementDetails,
  type ProtocolStatus,
  type BusinessStatus,
  asReceiptId,
} from "../types/domain.js";
import { evaluateNEP141Settlement, type NEP141TransferContext } from "../adapters/nep141.js";
import {
  DEFAULT_ASSET_REGISTRY,
  parseDIP4EventsFromLogs,
  type KnownChainAsset,
  type NormalizedOmnichainIntent,
} from "../adapters/dip4.js";

export interface SettlementEvaluationOptions {
  transferContext?: NEP141TransferContext;
}

/**
 * Universal Settlement Evaluator.
 * Inspects multi-shard DAG nodes, runs specialized adapters (NEP-141, DIP-4),
 * and computes dual-axis settlement outcomes (protocol_status vs business_status).
 */
export function evaluateSettlement(
  dag: InFlightDAG,
  options: SettlementEvaluationOptions = {}
): SettlementResolution {
  // 1. Try specialized NEP-141 adapter first (detects ft_resolve_transfer refunds)
  const nep141Resolution = evaluateNEP141Settlement(dag, options.transferContext);
  if (nep141Resolution) {
    return nep141Resolution;
  }

  // 2. Generic fallback evaluation for non-NEP141 transactions
  let totalGasBurnt = 0n;
  let hasFailure = false;
  let panickedReceiptId: string | undefined;
  let panicReason: string | undefined;

  for (const [, node] of dag.nodes) {
    try {
      totalGasBurnt += BigInt(node.gas_burnt);
    } catch {
      // Ignore parse failure
    }

    if (node.status.type === "Failure") {
      hasFailure = true;
      panickedReceiptId = node.receipt_id;
      panicReason = node.status.error.error_message;
    }

    if (!hasFailure) {
      const diagnosticLog = node.logs.find(
        (log) => log.toLowerCase().includes("panic") || log.toLowerCase().includes("error")
      );
      if (diagnosticLog) {
        panickedReceiptId = node.receipt_id;
        panicReason = diagnosticLog;
      }
    }
  }

  const protocolStatus: ProtocolStatus = hasFailure ? "FAILURE" : "SUCCESS";
  const businessStatus: BusinessStatus = hasFailure ? "FAILED" : "CONFIRMED";

  const amounts: SettlementAmounts = {
    transferred: "0",
    settled: "0",
    refunded: "0",
    currency: "UNKNOWN",
  };

  const details: SettlementDetails = {
    resolver_method: "direct_execution",
    raw_return_value: hasFailure ? "PANIC" : "SUCCESS",
    panicked_receipt_id: panickedReceiptId ? asReceiptId(panickedReceiptId) : undefined,
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

/**
 * Extracts omnichain intent details from execution logs across all DAG nodes.
 */
export function extractOmnichainIntent(
  dag: InFlightDAG,
  assetRegistry: Readonly<Record<string, KnownChainAsset>> = DEFAULT_ASSET_REGISTRY
): NormalizedOmnichainIntent | null {
  const allLogs: string[] = [];
  for (const [, node] of dag.nodes) {
    allLogs.push(...node.logs);
  }

  const intents = parseDIP4EventsFromLogs(allLogs, assetRegistry);
  return intents[0] ?? null;
}
