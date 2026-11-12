import {
  type ReceiptId,
  type TxHash,
  type InFlightDAG,
  type ExecutionOutcomeNode,
} from "../types/domain.js";

export interface DAGStateTransition {
  dag: InFlightDAG;
  is_complete: boolean;
  just_completed: boolean;
  unresolved_count: number;
  pruned_gas_refunds: ReceiptId[];
  topological_order?: ExecutionOutcomeNode[] | undefined;
}

export interface IngestOptions {
  enableGasPruning?: boolean;
}

/**
 * Creates an empty InFlightDAG state machine for a new transaction.
 * Invariant: root_registered starts as false until root receipt outcome is ingested.
 */
export function createInFlightDAG(
  txHash: TxHash,
  rootReceiptId: ReceiptId,
  nowMs: number = Date.now()
): InFlightDAG {
  const spawned = new Set<ReceiptId>();
  spawned.add(rootReceiptId);

  return {
    tx_hash: txHash,
    root_receipt_id: rootReceiptId,
    root_registered: false,
    nodes: new Map<ReceiptId, ExecutionOutcomeNode>(),
    spawned_receipt_ids: spawned,
    executed_receipt_ids: new Set<ReceiptId>(),
    pruned_gas_receipt_ids: new Set<ReceiptId>(),
    created_at: nowMs,
    updated_at: nowMs,
    is_complete: false,
    is_yielded: false,
  };
}

/**
 * Determines if an outcome represents a system gas refund ("gas change").
 * System refunds have predecessor_id == "system", empty logs, and no function call.
 */
export function isSystemGasRefundOutcome(node: ExecutionOutcomeNode): boolean {
  return (
    node.predecessor_id === "system" &&
    node.logs.length === 0 &&
    (node.method_name === undefined || node.method_name === "" || node.method_name === "refund")
  );
}

/**
 * Ingests a new receipt execution outcome into the in-flight DAG.
 * Evaluates completion condition: |S_spawned \ S_executed| == 0 AND root_registered === true.
 */
export function ingestReceiptOutcome(
  dag: InFlightDAG,
  outcome: ExecutionOutcomeNode,
  options: IngestOptions = { enableGasPruning: true }
): DAGStateTransition {
  const previouslyComplete = dag.is_complete;
  const prunedRefunds: ReceiptId[] = [];

  // Idempotency check: don't process the exact same outcome twice
  if (dag.executed_receipt_ids.has(outcome.receipt_id)) {
    return {
      dag,
      is_complete: dag.is_complete,
      just_completed: false,
      unresolved_count: computeUnresolvedCount(dag),
      pruned_gas_refunds: prunedRefunds,
      topological_order: dag.is_complete ? getTopologicalOrder(dag) : undefined,
    };
  }

  dag.updated_at = Date.now();
  dag.nodes.set(outcome.receipt_id, outcome);
  dag.executed_receipt_ids.add(outcome.receipt_id);

  // Invariant 1: Root-Registered Guard
  if (outcome.receipt_id === dag.root_receipt_id) {
    dag.root_registered = true;
  }

  // Register spawned child promises (prevent cyclic loops where child == parent)
  for (const childId of outcome.child_receipt_ids) {
    if (childId !== outcome.receipt_id) {
      dag.spawned_receipt_ids.add(childId);
    }
  }

  // Two-Way Webhook detection: check for native yield_create events in logs
  for (const log of outcome.logs) {
    if (log.includes("yield_created")) {
      dag.is_yielded = true;
      try {
        const match = log.match(/\{.*"yield_token":\s*"([^"]+)".*\}/);
        if (match && match[1]) {
          dag.yield_token = match[1];
        }
      } catch {
        // Fallback: log didn't contain JSON regex match
      }
    }
  }

  // Invariant 2: Gas Refund Pruning Rule (~600ms latency win)
  if (options.enableGasPruning) {
    if (isSystemGasRefundOutcome(outcome)) {
      dag.pruned_gas_receipt_ids.add(outcome.receipt_id);
      dag.spawned_receipt_ids.delete(outcome.receipt_id);
      prunedRefunds.push(outcome.receipt_id);
    }
  }

  const unresolvedCount = computeUnresolvedCount(dag);

  // Invariant 3: Terminal Completeness Trigger
  // Settlement occurs if and only if unresolved count is 0 AND root has executed.
  const isComplete = dag.root_registered && unresolvedCount === 0;
  dag.is_complete = isComplete;

  const justCompleted = isComplete && !previouslyComplete;

  let topologicalOrder: ExecutionOutcomeNode[] | undefined;
  if (isComplete) {
    topologicalOrder = getTopologicalOrder(dag);
  }

  return {
    dag,
    is_complete: isComplete,
    just_completed: justCompleted,
    unresolved_count: unresolvedCount,
    pruned_gas_refunds: prunedRefunds,
    topological_order: topologicalOrder,
  };
}

/**
 * Computes |S_spawned \ S_executed|
 */
export function computeUnresolvedCount(dag: InFlightDAG): number {
  let count = 0;
  for (const id of dag.spawned_receipt_ids) {
    if (!dag.executed_receipt_ids.has(id)) {
      count++;
    }
  }
  return count;
}

/**
 * Performs Kahn's algorithm for causal topological ordering of DAG vertices.
 * Resolves (u, v) in E => index(u) < index(v).
 */
export function getTopologicalOrder(dag: InFlightDAG): ExecutionOutcomeNode[] {
  const inDegree = new Map<ReceiptId, number>();
  const adj = new Map<ReceiptId, ReceiptId[]>();

  // Initialize graph representation
  for (const [id] of dag.nodes) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  // Populate edges: parent -> child
  for (const [parentId, node] of dag.nodes) {
    for (const childId of node.child_receipt_ids) {
      if (dag.nodes.has(childId)) {
        adj.get(parentId)?.push(childId);
        inDegree.set(childId, (inDegree.get(childId) ?? 0) + 1);
      }
    }
  }

  // Queue nodes with in-degree 0 (start with root or independent nodes)
  const queue: ReceiptId[] = [];
  if (dag.nodes.has(dag.root_receipt_id) && (inDegree.get(dag.root_receipt_id) ?? 0) === 0) {
    queue.push(dag.root_receipt_id);
  }

  // Add any other nodes with in-degree 0
  for (const [id, deg] of inDegree) {
    if (deg === 0 && id !== dag.root_receipt_id) {
      queue.push(id);
    }
  }

  const result: ExecutionOutcomeNode[] = [];
  const visited = new Set<ReceiptId>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const node = dag.nodes.get(currentId);
    if (node) {
      result.push(node);
    }

    const neighbors = adj.get(currentId) ?? [];
    for (const neighbor of neighbors) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Fallback: If cycles or orphaned components exist, append any unvisited nodes
  for (const [id, node] of dag.nodes) {
    if (!visited.has(id)) {
      result.push(node);
    }
  }

  return result;
}
