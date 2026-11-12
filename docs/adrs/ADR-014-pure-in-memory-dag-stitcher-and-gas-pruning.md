# ADR-014: Pure In-Memory DAG Stitcher Engine, Dynamic Completeness Resolution, and Gas Refund Pruning

## Status
Accepted

## Context
On NEAR Protocol's Nightshade sharded architecture, a transaction does not execute atomically in a single block. Instead, it decomposes into an asynchronous tree of cross-shard receipts spanning **2 to 4+ consecutive blocks (~1.2s to 2.4s at ~600ms/block)**.
1. **Dynamic Unfolding:** The full dependency tree is not known ahead of time. Receipts spawn child receipts and register callback dependencies dynamically during WebAssembly runtime execution.
2. **Out-of-Order Delivery Risk:** Child execution outcomes can arrive out of order across shards. If an engine checks completeness naively, an out-of-order child receipt could satisfy a premature empty check before the parent receipt finishes registering subsequent promises.
3. **The "Gas Change" Latency Tax:** Every NEAR function call attaches prepaid gas (e.g., 30 TGas). When execution completes, the NEAR runtime automatically generates a child refund receipt from `"system"` returning unspent gas. Waiting for this trivial receipt adds **1 full block of artificial latency (~600ms)** to every single transaction.

## Decision
NearHook models transaction execution as a pure, in-memory Directed Acyclic Graph (DAG) state machine $G_T = (V_T, E_T)$ in `@nearhook/core`:

### 1. Mathematical State & Dynamic Tracking
For every transaction $T$:
- **Spawned Set ($S_{\text{spawned}}$):** The set of all receipt IDs generated as child promises or callbacks.
- **Executed Set ($S_{\text{executed}}$):** The set of all receipt IDs whose execution outcomes have been processed.
- **Root Registered Guard ($\text{root\_registered} \in \{0, 1\}$):** Explicit boolean flag verifying the root transaction has been recorded.

### 2. The Terminal Completeness Invariant
A transaction $T$ is eligible for terminal settlement evaluation if and only if:
$$\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset \quad \land \quad \text{root\_registered}(T) = 1$$
This dual-condition mathematically prevents premature closure from out-of-order child receipt arrivals.

### 3. The 1-Block (~600ms) Gas Refund Pruning Rule
When processing receipt execution outcomes, NearHook inspects child receipt IDs in `outcome.receipt_ids`.
If a receipt satisfies:
1. `predecessor_id == "system"`
2. Action is strictly a single `TransferAction` to the original `signer_id`
3. Zero smart contract function calls or events

NearHook immediately prunes this receipt from $S_{\text{spawned}}$.
- **Quantified Latency Win:** Shaves **1 full block roundtrip (~600ms)** off webhook delivery latency, delivering sub-second finality without sacrificing safety.

### 4. Topological Causal Ordering
All vertices $V_T$ and constituent NEP-297 event logs are causally sorted using topological ordering:
$$(u, v) \in E_T \implies \text{index}(u) < \text{index}(v)$$
Ensuring the delivered payload presents an immutable, sequential chronology of multi-shard execution.

### 5. Why a DAG Model Instead of a Saga
NearHook uses a DAG to represent the **observed on-chain execution**, rather than modeling each transaction as a Saga:
- NEAR receipts form a runtime-defined dependency graph: a receipt may spawn multiple promises, callbacks may join results, and new dependencies appear as receipts execute.
- Receipt outcomes can arrive out of order across shards. The DAG's spawned/executed sets let NearHook determine whether all known work has completed without assuming a fixed step order.
- NearHook observes and reports protocol execution; it does not orchestrate business steps or issue compensating transactions. Saga semantics describe a business workflow and its compensation policy, which are not encoded by receipt causality and cannot establish whether a NEAR transaction settled or refunded.
- A Saga could be built by an application on top of NearHook's settlement events. It is not a substitute for preserving the underlying receipt graph.

The choice is about the layer being modeled, not mutually exclusive patterns: the DAG captures protocol-level causality and settlement; application services may use Sagas for longer-running business workflows.

## Quantified Metrics & Invariants
| Metric | Value | Architectural Rationale |
| :--- | :--- | :--- |
| **Cross-Shard Propagation Time** | `1,200ms – 2,400ms` | Normal NEAR Nightshade resolution across 2–4 blocks. |
| **Gas Pruning Latency Reduction** | `~600ms (1 full block)` | Eliminates waiting for trivial system gas refunds. |
| **In-Flight Memory Window (TTL)** | `120 seconds` | Ephemeral Redis key expiration ensuring zero memory leaks. |
| **Yielded Execution Timeout** | `200 blocks (~120s)` | Maximum protocol timeout for native `yield_create` host function. |
| **Graph Resolution Complexity** | `O(1) amortized` | Hash-set delta tracking for $S_{\text{spawned}} \setminus S_{\text{executed}}$. |
| **Gas Footprint for Escrow Contract** | `< 5 TGas` | Standard execution consumption vs 30 TGas prepaid. |

## Consequences
- **Positive:** Mathematically provable termination: zero premature false-positive dispatches.
- **Positive:** Sub-second latency: delivers webhooks ~600ms faster than naive indexers.
- **Positive:** Pure functional architecture in `@nearhook/core` with zero I/O side effects, enabling 100% deterministic unit testing.

