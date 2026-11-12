import {
  asAccountId,
  asReceiptId,
  asTxHash,
  type ExecutionOutcomeNode,
  type ExecutionStatus,
} from "@nearhook/core";
import type { BlockEnvelope } from "../types.js";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Missing ${field}`);
  return value;
}

function number(value: unknown, field: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError(`Invalid ${field}`);
  return result;
}

function statusFrom(value: unknown): ExecutionStatus {
  const status = object(value);
  if (!status) throw new TypeError("Execution outcome status is missing");
  if (typeof status.SuccessValue === "string") return { type: "SuccessValue", value: status.SuccessValue };
  if (typeof status.SuccessReceiptId === "string") {
    return { type: "SuccessReceiptId", receipt_id: asReceiptId(status.SuccessReceiptId) };
  }
  if (status.Failure !== undefined) {
    const failure = object(status.Failure);
    const errorMessage = typeof failure?.ActionError === "string"
      ? failure.ActionError
      : typeof failure?.error_message === "string"
        ? failure.error_message
        : JSON.stringify(status.Failure);
    const errorType = typeof failure?.error_type === "string" ? failure.error_type : undefined;
    return {
      type: "Failure",
      error: { error_message: errorMessage, ...(errorType ? { error_type: errorType } : {}) },
    };
  }
  throw new TypeError("Unsupported execution outcome status");
}

function decodeArgs(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return object(decoded) ?? undefined;
  } catch {
    return undefined;
  }
}

function callFields(actions: unknown): { method_name?: string; args_json?: Record<string, unknown> } {
  if (!Array.isArray(actions)) return {};
  for (const item of actions) {
    const action = object(item);
    const call = object(action?.FunctionCall);
    if (call && typeof call.method_name === "string") {
      const args = decodeArgs(call.args);
      return { method_name: call.method_name, ...(args ? { args_json: args } : {}) };
    }
  }
  return {};
}

function outcomeNode(
  execution: JsonObject,
  receipt: JsonObject,
  shardId: number,
  blockHeight: number,
  txHash: string,
  actions?: unknown
): ExecutionOutcomeNode {
  const outcome = object(execution.outcome);
  if (!outcome) throw new TypeError("Execution outcome summary is missing");
  const receiptId = requiredString(execution.id ?? receipt.receipt_id, "receipt id");
  const childIds = Array.isArray(outcome.receipt_ids)
    ? outcome.receipt_ids.filter((id): id is string => typeof id === "string")
    : [];
  const receiptBody = object(receipt.receipt);
  const actionReceipt = object(receiptBody?.Action);
  const actionFields = callFields(actions ?? actionReceipt?.actions);
  return {
    receipt_id: asReceiptId(receiptId),
    tx_hash: asTxHash(txHash),
    block_height: blockHeight,
    shard_id: shardId,
    predecessor_id: asAccountId(requiredString(receipt.predecessor_id ?? outcome.executor_id, "predecessor id")),
    receiver_id: asAccountId(requiredString(receipt.receiver_id ?? outcome.executor_id, "receiver id")),
    status: statusFrom(outcome.status),
    gas_burnt: String(outcome.gas_burnt ?? "0"),
    tokens_burnt: String(outcome.tokens_burnt ?? "0"),
    logs: Array.isArray(outcome.logs) ? outcome.logs.filter((log): log is string => typeof log === "string") : [],
    child_receipt_ids: childIds.map(asReceiptId),
    ...actionFields,
  };
}

function unwrapExecution(value: unknown): { execution: JsonObject; receipt: JsonObject } | null {
  const wrapper = object(value);
  const execution = object(wrapper?.execution_outcome);
  const receipt = object(wrapper?.receipt);
  return execution && receipt ? { execution, receipt } : null;
}

/** Converts the documented NEAR Data block envelope to the engine's normalized outcome model. */
export function normalizeNeardataBlock(raw: unknown): BlockEnvelope {
  const blockDocument = object(raw);
  if (!blockDocument) throw new TypeError("FastNear block response must be an object");
  const block = object(blockDocument.block);
  const header = object(block?.header);
  const height = number(header?.height ?? blockDocument.height, "block height");
  const shards = blockDocument.shards;
  if (!Array.isArray(shards)) throw new TypeError("FastNear block response is missing shards");

  const outcomes: ExecutionOutcomeNode[] = [];
  for (const rawShard of shards) {
    const shard = object(rawShard);
    if (!shard) continue;
    const shardId = number(shard.shard_id, "shard id");
    const chunk = object(shard.chunk);
    if (Array.isArray(chunk?.transactions)) {
      for (const rawTransaction of chunk.transactions) {
        const wrapper = object(rawTransaction);
        const transaction = object(wrapper?.transaction);
        const result = object(wrapper?.outcome);
        const execution = object(result?.execution_outcome);
        if (!transaction || !execution) continue;
        const txHash = requiredString(transaction.hash, "transaction hash");
        outcomes.push(outcomeNode(
          execution,
          {
            receipt_id: execution.id,
            predecessor_id: transaction.signer_id,
            receiver_id: transaction.receiver_id,
          },
          shardId,
          height,
          txHash,
          transaction.actions
        ));
      }
    }

    if (!Array.isArray(shard.receipt_execution_outcomes)) continue;
    for (const rawReceiptOutcome of shard.receipt_execution_outcomes) {
      const wrapper = object(rawReceiptOutcome);
      const result = unwrapExecution(rawReceiptOutcome);
      if (!wrapper || !result) continue;
      const txHash = requiredString(wrapper.tx_hash, "receipt transaction hash");
      outcomes.push(outcomeNode(result.execution, result.receipt, shardId, height, txHash));
    }
  }

  outcomes.sort((left, right) => {
    const leftIsRoot = String(left.receipt_id) === String(left.tx_hash);
    const rightIsRoot = String(right.receipt_id) === String(right.tx_hash);
    return Number(rightIsRoot) - Number(leftIsRoot);
  });
  return { height, outcomes };
}
