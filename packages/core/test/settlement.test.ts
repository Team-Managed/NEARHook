import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createInFlightDAG,
  ingestReceiptOutcome,
  evaluateSettlement,
  extractOmnichainIntent,
  parseDIP4EventsFromLogs,
  asReceiptId,
  asTxHash,
  asAccountId,
  type ExecutionOutcomeNode,
} from "../dist/index.js";

describe("Settlement Adapters & Omnichain Evaluator", () => {
  const txHash = asTxHash("tx_settle_999");
  const rootId = asReceiptId("rcpt_transfer_call");

  function makeOutcome(
    id: string,
    methodName: string,
    children: string[] = [],
    options: {
      predecessor?: string;
      receiver?: string;
      returnValueBase64?: string;
      isFailure?: boolean;
      errorMessage?: string;
      logs?: string[];
      argsJson?: Record<string, unknown>;
    } = {}
  ): ExecutionOutcomeNode {
    return {
      receipt_id: asReceiptId(id),
      tx_hash: txHash,
      block_height: 100,
      shard_id: 1,
      predecessor_id: asAccountId(options.predecessor ?? "alice.near"),
      receiver_id: asAccountId(options.receiver ?? "usdc.near"),
      status: options.isFailure
        ? { type: "Failure", error: { error_message: options.errorMessage ?? "Smart contract panicked" } }
        : { type: "SuccessValue", value: options.returnValueBase64 ?? "" },
      gas_burnt: "3500000000000",
      tokens_burnt: "0",
      logs: options.logs ?? [],
      child_receipt_ids: children.map(asReceiptId),
      method_name: methodName,
      args_json: options.argsJson,
    };
  }

  test("1. Successful ft_transfer_call evaluates to CONFIRMED (0 refund)", () => {
    const dag = createInFlightDAG(txHash, rootId);

    // Root: ft_transfer_call for 100 USDC
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_transfer_call", "ft_transfer_call", ["rcpt_on_transfer", "rcpt_resolve_transfer"], {
        receiver: "usdc.near",
        argsJson: { amount: "100000000", receiver_id: "merchant-escrow.testnet" },
      })
    );

    // Child 1: ft_on_transfer succeeds on merchant
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_on_transfer", "ft_on_transfer", [], {
        predecessor: "usdc.near",
        receiver: "merchant-escrow.testnet",
        returnValueBase64: Buffer.from('"0"').toString("base64"),
      })
    );

    // Child 2 (Callback): ft_resolve_transfer returns "0" (0 refunded)
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_resolve_transfer", "ft_resolve_transfer", [], {
        predecessor: "usdc.near",
        receiver: "usdc.near",
        returnValueBase64: Buffer.from('"0"').toString("base64"),
        argsJson: { amount: "100000000" },
      })
    );

    assert.equal(dag.is_complete, true);

    const resolution = evaluateSettlement(dag);
    assert.equal(resolution.protocol_status, "SUCCESS");
    assert.equal(resolution.business_status, "CONFIRMED");
    assert.equal(resolution.amounts.transferred, "100000000");
    assert.equal(resolution.amounts.settled, "100000000");
    assert.equal(resolution.amounts.refunded, "0");
    assert.equal(resolution.details.resolver_method, "ft_resolve_transfer");
  });

  test("2. Out-of-stock merchant triggers ft_resolve_transfer 100% refund (REFUNDED)", () => {
    const dag = createInFlightDAG(txHash, rootId);

    // Root
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_transfer_call", "ft_transfer_call", ["rcpt_on_transfer", "rcpt_resolve_transfer"], {
        argsJson: { amount: "100000000" },
      })
    );

    // Merchant contract panics: "Item out of stock"
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_on_transfer", "ft_on_transfer", [], {
        isFailure: true,
        errorMessage: "Smart contract panicked: Order #402: Item out of stock",
      })
    );

    // ft_resolve_transfer returns full 100000000 refund to alice
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_resolve_transfer", "ft_resolve_transfer", [], {
        returnValueBase64: Buffer.from('"100000000"').toString("base64"),
        argsJson: { amount: "100000000" },
      })
    );

    assert.equal(dag.is_complete, true);

    const resolution = evaluateSettlement(dag);
    // Protocol succeeded because the resolver handled the panic cleanly!
    assert.equal(resolution.protocol_status, "SUCCESS");
    // Business status correctly classified as REFUNDED
    assert.equal(resolution.business_status, "REFUNDED");
    assert.equal(resolution.amounts.transferred, "100000000");
    assert.equal(resolution.amounts.settled, "0");
    assert.equal(resolution.amounts.refunded, "100000000");

    // Diagnostic details accurately preserve the root cause
    assert.equal(resolution.details.panicked_receipt_id, asReceiptId("rcpt_on_transfer"));
    assert.match(resolution.details.panic_reason ?? "", /Item out of stock/);
  });

  test("3. Partial order fulfillment returns PARTIALLY_REFUNDED with exact amount breakdown", () => {
    const dag = createInFlightDAG(txHash, rootId);

    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_transfer_call", "ft_transfer_call", ["rcpt_on_transfer", "rcpt_resolve_transfer"], {
        argsJson: { amount: "100000000" },
      })
    );

    // Merchant partially fulfills: 30 USDC accepted, 70 USDC refunded
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_on_transfer", "ft_on_transfer", [], {
        logs: ["Partial inventory: only 3 of 10 items in stock"],
      })
    );

    // ft_resolve_transfer returns "70000000" (refunded to buyer)
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_resolve_transfer", "ft_resolve_transfer", [], {
        returnValueBase64: Buffer.from('"70000000"').toString("base64"),
        argsJson: { amount: "100000000" },
      })
    );

    const resolution = evaluateSettlement(dag);
    assert.equal(resolution.protocol_status, "SUCCESS");
    assert.equal(resolution.business_status, "PARTIALLY_REFUNDED");
    assert.equal(resolution.amounts.transferred, "100000000");
    assert.equal(resolution.amounts.settled, "30000000");
    assert.equal(resolution.amounts.refunded, "70000000");
    assert.equal(resolution.details.raw_return_value, "70000000");
  });

  test("4. Unhandled runtime panic evaluates to FAILURE / FAILED", () => {
    const dag = createInFlightDAG(txHash, rootId);

    // Direct contract call without resolver callback that panics catastrophically
    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_transfer_call", "direct_call", [], {
        isFailure: true,
        errorMessage: "HostError(CostOverflow)",
      })
    );

    const resolution = evaluateSettlement(dag);
    assert.equal(resolution.protocol_status, "FAILURE");
    assert.equal(resolution.business_status, "FAILED");
    assert.equal(resolution.details.panic_reason, "HostError(CostOverflow)");
  });

  test("5. DIP-4 intent logs parsed with accurate decimal normalization", () => {
    const rawLogs = [
      'EVENT_JSON:{"standard":"dip4","version":"1.0.0","event":"intent_execution","data":[{"intent_id":"int_777","source_chain":"SOLANA","destination_chain":"BITCOIN","token_in":"nep141:sol.omft.near","token_out":"nep141:btc.omft.near","amount_in":"1500000000","amount_out":"25000000"}]}',
    ];

    const intents = parseDIP4EventsFromLogs(rawLogs);
    assert.equal(intents.length, 1);

    const intent = intents[0]!;
    assert.equal(intent.intent_id, "int_777");
    assert.equal(intent.source_chain, "SOLANA");
    assert.equal(intent.destination_chain, "BITCOIN");
    assert.equal(intent.token_in, "SOL");
    assert.equal(intent.token_out, "BTC");
    assert.equal(intent.amount_in_formatted, "1.5 SOL");
    assert.equal(intent.amount_out_formatted, "0.25 BTC");
  });

  test("6. extractOmnichainIntent integrates with InFlightDAG node logs", () => {
    const dag = createInFlightDAG(txHash, rootId);

    ingestReceiptOutcome(
      dag,
      makeOutcome("rcpt_transfer_call", "execute_intent", [], {
        logs: [
          'EVENT_JSON:{"standard":"dip4","version":"1.0.0","event":"intent_execution","data":[{"intent_id":"int_999","token_in":"nep141:sol.omft.near","token_out":"nep141:wrap.near","amount_in":"3000000000","amount_out":"1000000000000000000000000"}]}',
        ],
      })
    );

    const intent = extractOmnichainIntent(dag);
    assert.notEqual(intent, null);
    assert.equal(intent?.token_in, "SOL");
    assert.equal(intent?.token_out, "NEAR");
    assert.equal(intent?.amount_in_formatted, "3 SOL");
    assert.equal(intent?.amount_out_formatted, "1 NEAR");
  });
});

