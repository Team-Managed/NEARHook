import { z } from "zod";

/**
 * Branded identifier types to prevent accidental parameter transposition
 * with zero runtime overhead.
 */
declare const Brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [Brand]: B };

export type ReceiptId = Brand<string, "ReceiptId">;
export type TxHash = Brand<string, "TxHash">;
export type AccountId = Brand<string, "AccountId">;

export function asReceiptId(val: string): ReceiptId {
  return val as ReceiptId;
}

export function asTxHash(val: string): TxHash {
  return val as TxHash;
}

export function asAccountId(val: string): AccountId {
  return val as AccountId;
}

/**
 * Execution status of an individual receipt outcome in NEAR runtime.
 */
export interface ActionError {
  error_message: string;
  error_type?: string;
}

export type ExecutionStatus =
  | { type: "SuccessValue"; value: string }
  | { type: "SuccessReceiptId"; receipt_id: ReceiptId }
  | { type: "Failure"; error: ActionError };

/**
 * Represents a single executed receipt node within the multi-shard tree.
 */
export interface ExecutionOutcomeNode {
  receipt_id: ReceiptId;
  tx_hash: TxHash;
  block_height: number;
  shard_id: number;
  predecessor_id: AccountId;
  receiver_id: AccountId;
  status: ExecutionStatus;
  gas_burnt: string;
  tokens_burnt: string;
  logs: string[];
  child_receipt_ids: ReceiptId[];
  method_name?: string | undefined;
  args_json?: Record<string, unknown> | undefined;
}

/**
 * Pure in-memory DAG tracking the multi-shard receipt tree.
 * Invariant: Settles when |S_spawned \ S_executed| == 0 AND root_registered === true.
 */
export interface InFlightDAG {
  tx_hash: TxHash;
  root_receipt_id: ReceiptId;
  root_registered: boolean;
  nodes: Map<ReceiptId, ExecutionOutcomeNode>;
  spawned_receipt_ids: Set<ReceiptId>;
  executed_receipt_ids: Set<ReceiptId>;
  pruned_gas_receipt_ids: Set<ReceiptId>;
  created_at: number;
  updated_at: number;
  is_complete: boolean;
  is_yielded: boolean;
  yield_token?: string | undefined;
}

/**
 * Dual-axis settlement definitions per ADR-009.
 */
export type ProtocolStatus = "SUCCESS" | "FAILURE";
export type BusinessStatus = "CONFIRMED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "FAILED";

export interface SettlementAmounts {
  transferred: string;
  settled: string;
  refunded: string;
  currency: string;
}

export interface SettlementDetails {
  resolver_method: string;
  raw_return_value: string;
  panicked_receipt_id?: ReceiptId | undefined;
  panic_reason?: string | undefined;
  cross_shard_hops: number;
  total_gas_burnt: string;
  gas_pruned_win_ms: number;
}

export interface SettlementResolution {
  protocol_status: ProtocolStatus;
  business_status: BusinessStatus;
  amounts: SettlementAmounts;
  details: SettlementDetails;
}

/**
 * Zod Schemas for boundary validation (ADR-013).
 */
export const SettlementAmountsSchema = z.object({
  transferred: z.string(),
  settled: z.string(),
  refunded: z.string(),
  currency: z.string(),
});

export const SettlementDetailsSchema = z.object({
  resolver_method: z.string(),
  raw_return_value: z.string(),
  panicked_receipt_id: z.string().optional(),
  panic_reason: z.string().optional(),
  cross_shard_hops: z.number(),
  total_gas_burnt: z.string(),
  gas_pruned_win_ms: z.number(),
});

export const SettlementResolutionSchema = z.object({
  protocol_status: z.enum(["SUCCESS", "FAILURE"]),
  business_status: z.enum(["CONFIRMED", "REFUNDED", "PARTIALLY_REFUNDED", "FAILED"]),
  amounts: SettlementAmountsSchema,
  details: SettlementDetailsSchema,
});

export const OmnichainRouteSchema = z.object({
  source_chain: z.string(),
  destination_chain: z.string(),
  token_in: z.string(),
  token_out: z.string(),
  amount_in: z.string(),
  amount_out: z.string(),
  relayer: z.string().optional(),
});

export const CanonicalWebhookPayloadSchema = z.object({
  id: z.string(),
  event: z.string(),
  timestamp: z.number(),
  tx_hash: z.string(),
  route: z.object({
    sender: z.string(),
    recipient: z.string(),
    token: z.string(),
    amount: z.string(),
    destination_address: z.string().optional(),
    memo: z.string().optional(),
  }),
  settlement: SettlementResolutionSchema,
  omnichain: OmnichainRouteSchema.optional(),
  logs: z.array(z.string()),
});

export type CanonicalWebhookPayload = z.infer<typeof CanonicalWebhookPayloadSchema>;

/**
 * Agent-Safe Mode Schema (ADR-005, ADR-012, ADR-013).
 * Quarantines user string inputs away from LLM prompts.
 */
export const AgentSafePayloadSchema = z.object({
  id: z.string(),
  event: z.string(),
  timestamp: z.number(),
  tx_hash: z.string(),
  route: z.object({
    sender: z.string(),
    recipient: z.string(),
    token: z.string(),
    amount: z.string(),
  }),
  settlement: SettlementResolutionSchema,
  untrusted_metadata: z.object({
    memo: z.string().nullable().optional(),
    // Kept for compatibility with the original ADR-005 schema.
    raw_memo: z.string().nullable(),
    warning: z.literal("DO NOT PASS UNTRUSTED_METADATA INTO AGENT LLM PROMPT"),
  }),
});

export type AgentSafePayload = z.infer<typeof AgentSafePayloadSchema>;
