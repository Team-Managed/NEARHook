import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createInFlightDAG,
  ingestReceiptOutcome,
  getTopologicalOrder,
  asReceiptId,
  asTxHash,
  asAccountId,
  type ExecutionOutcomeNode,
} from "../dist/index.js";

describe("Pure DAG Stitcher & Gas Refund Pruning Engine", () => {
  const txHash = asTxHash("tx_multi_shard_123");
  const rootId = asReceiptId("rcpt_root");

  function makeOutcome(
    id: string,
    children: string[] = [],
    options: {
      predecessor?: string;
      receiver?: string;
      methodName?: string;
      logs?: string[];
    } = {}
  ): ExecutionOutcomeNode {
    return {
      receipt_id: asReceiptId(id),
      tx_hash: txHash,
      block_height: 100,
      shard_id: 0,
      predecessor_id: asAccountId(options.predecessor ?? "alice.near"),
      receiver_id: asAccountId(options.receiver ?? "merchant-escrow.testnet"),
      status: { type: "SuccessValue", value: "" },
      gas_burnt: "2500000000000",
      tokens_burnt: "0",
      logs: options.logs ?? [],
      child_receipt_ids: children.map(asReceiptId),
      method_name: options.methodName ?? "ft_transfer_call",
    };
  }

  test("1. Single atomic receipt settles immediately upon ingestion", () => {
    const dag = createInFlightDAG(txHash, rootId);
    assert.equal(dag.is_complete, false);
    assert.equal(dag.root_registered, false);

    const rootOutcome = makeOutcome("rcpt_root", []);
    const transition = ingestReceiptOutcome(dag, rootOutcome);

    assert.equal(transition.is_complete, true);
    assert.equal(transition.just_completed, true);
    assert.equal(transition.unresolved_count, 0);
    assert.equal(transition.dag.root_registered, true);
    assert.equal(transition.topological_order?.length, 1);
    assert.equal(transition.topological_order[0]?.receipt_id, rootId);
  });

  test("2. Multi-shard 3-block receipt tree settles only when leaf executes", () => {
    // Tree: rcpt_root -> [rcpt_child_1] -> [rcpt_leaf]
    const dag = createInFlightDAG(txHash, rootId);

    // Block 1: Root executes, spawning child_1
    const t1 = ingestReceiptOutcome(dag, makeOutcome("rcpt_root", ["rcpt_child_1"]));
    assert.equal(t1.is_complete, false);
    assert.equal(t1.just_completed, false);
    assert.equal(t1.unresolved_count, 1); // child_1 unresolved

    // Block 2: child_1 executes, spawning leaf
    const t2 = ingestReceiptOutcome(dag, makeOutcome("rcpt_child_1", ["rcpt_leaf"]));
    assert.equal(t2.is_complete, false);
    assert.equal(t2.unresolved_count, 1); // leaf unresolved

    // Block 3: leaf executes, spawning 0 children
    const t3 = ingestReceiptOutcome(dag, makeOutcome("rcpt_leaf", []));
    assert.equal(t3.is_complete, true);
    assert.equal(t3.just_completed, true);
    assert.equal(t3.unresolved_count, 0);

    // Verify causal topological order: root -> child_1 -> leaf
    const order = t3.topological_order!;
    assert.equal(order.length, 3);
    assert.equal(order[0]?.receipt_id, asReceiptId("rcpt_root"));
    assert.equal(order[1]?.receipt_id, asReceiptId("rcpt_child_1"));
    assert.equal(order[2]?.receipt_id, asReceiptId("rcpt_leaf"));
  });

  test("3. Out-of-order child arrival does not trigger premature completion (root guard)", () => {
    // Scenario: Child receipt on shard 2 arrives before root receipt on shard 0
    const dag = createInFlightDAG(txHash, rootId);

    const childOutcome = makeOutcome("rcpt_child_fast", []);
    const tChild = ingestReceiptOutcome(dag, childOutcome);

    // Even though child finished and spawned 0 children, root is not registered!
    assert.equal(tChild.is_complete, false);
    assert.equal(dag.root_registered, false);

    // Now root arrives and links child_fast
    const rootOutcome = makeOutcome("rcpt_root", ["rcpt_child_fast"]);
    const tRoot = ingestReceiptOutcome(dag, rootOutcome);

    // Both have executed, root is registered -> now complete
    assert.equal(tRoot.is_complete, true);
    assert.equal(tRoot.just_completed, true);
    assert.equal(dag.root_registered, true);
  });

  test("4. System gas refund receipt is pruned and shaves 1 block (~600ms latency win)", () => {
    // Normal tree with a gas refund child from system
    const dag = createInFlightDAG(txHash, rootId);

    // Root spawns a business child and a system gas refund
    const rootOutcome = makeOutcome("rcpt_root", ["rcpt_business_action", "rcpt_gas_refund"]);
    ingestReceiptOutcome(dag, rootOutcome);

    // System gas refund arrives
    const gasRefundOutcome = makeOutcome("rcpt_gas_refund", [], {
      predecessor: "system",
      receiver: "alice.near",
      methodName: "",
      logs: [],
    });

    const tRefund = ingestReceiptOutcome(dag, gasRefundOutcome);
    assert.equal(tRefund.pruned_gas_refunds.length, 1);
    assert.equal(tRefund.pruned_gas_refunds[0], asReceiptId("rcpt_gas_refund"));
    assert.equal(dag.pruned_gas_receipt_ids.has(asReceiptId("rcpt_gas_refund")), true);

    // rcpt_gas_refund is pruned from spawned set; only rcpt_business_action remains
    assert.equal(dag.spawned_receipt_ids.has(asReceiptId("rcpt_gas_refund")), false);
    assert.equal(dag.is_complete, false);

    // When rcpt_business_action executes, DAG completes without waiting for any further gas refunds!
    const tBiz = ingestReceiptOutcome(dag, makeOutcome("rcpt_business_action", []));
    assert.equal(tBiz.is_complete, true);
    assert.equal(tBiz.just_completed, true);
  });

  test("5. Contrived cyclic loops are prevented from infinite spawning", () => {
    const dag = createInFlightDAG(txHash, rootId);

    // Outcome claims to spawn itself as child
    const selfSpawningOutcome = makeOutcome("rcpt_root", ["rcpt_root"]);
    const transition = ingestReceiptOutcome(dag, selfSpawningOutcome);

    // Self-loop ignored; settles immediately
    assert.equal(transition.is_complete, true);
    assert.equal(transition.unresolved_count, 0);
  });

  test("6. Two-Way Webhook native yield_create sets is_yielded and extracts yield_token", () => {
    const dag = createInFlightDAG(txHash, rootId);

    const yieldOutcome = makeOutcome("rcpt_root", [], {
      logs: [
        'EVENT_JSON:{"standard":"nearhook","version":"1.0.0","event":"yield_created","data":{"yield_token":"tok_test_abc123","action":"kyc_check"}}',
      ],
    });

    const transition = ingestReceiptOutcome(dag, yieldOutcome);
    assert.equal(transition.dag.is_yielded, true);
    assert.equal(transition.dag.yield_token, "tok_test_abc123");
  });

  test("7. Idempotent re-ingestion does not double complete or corrupt state", () => {
    const dag = createInFlightDAG(txHash, rootId);
    const rootOutcome = makeOutcome("rcpt_root", []);

    const t1 = ingestReceiptOutcome(dag, rootOutcome);
    assert.equal(t1.just_completed, true);

    const t2 = ingestReceiptOutcome(dag, rootOutcome);
    assert.equal(t2.is_complete, true);
    assert.equal(t2.just_completed, false); // Not newly completed
  });
});

