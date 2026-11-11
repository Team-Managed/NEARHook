# NearHook Specification: Asynchronous Receipt-Aware Event Delivery, Omnichain Clearinghouse Ingress, and Local Tunneling

---

## 1. Problem Statement
Developers and autonomous AI agents building on NEAR Protocol or integrating cross-chain operations face distinct event-ingestion barriers:
1. **Nightshade Sharding & Optimistic Settlement Vulnerability:** A single NEAR transaction decomposes into an asynchronous tree of cross-shard execution receipts spanning 2 to 4+ blocks. Naive indexers trigger callbacks when a root transaction is included at Block $B_t$, even though a child cross-contract promise may panic at Block $B_{t+1}$ and trigger a refund callback at Block $B_{t+2}$, causing downstream services or agents to release funds or merchandise prematurely.
2. **Naive Failure Classification & Refund Misinterpretation:** Naive indexers mark an entire transaction as failed if any intermediate receipt fails, failing to recognize that contracts deliberately register callback promises (e.g. NEP-141 `ft_resolve_transfer`) to handle failures and execute business refunds gracefully.
3. **High Idle Compute Costs for Autonomous Agents:** AI agents must either run expensive continuous RPC polling loops (`while(true)`) or operate heavyweight AWS S3 Lake consumers, burning compute 24/7 even during idle periods.
4. **Local Development Friction:** Firewalls and NAT prevent cloud webhooks from reaching local developer machines (`localhost:3000`) without configuring third-party tunneling utilities (e.g. ngrok).

---

## 2. Solution
NearHook provides a dedicated, real-time event-push gateway and native local-tunneling protocol for NEAR:
1. **Receipt Dependency Tracking & Settlement Evaluation:** Tracks root receipts, spawned promises, and callback dependencies across shards, confirming terminal resolution against a contiguous block ingestion sequence. Evaluates both technical protocol status and business-level settlement status (e.g. checking `ft_resolve_transfer` return amounts and NEP-297 event logs).
2. **NEAR Clearinghouse Event Ingress:** Normalizes events settling on NEAR's universal clearinghouses (`intents.near` NEP-297/DIP-4 logs and `v1.signer` MPC Chain Signatures).
3. **Cryptographically Attested Delivery:** Asymmetric Ed25519 relayer signatures, pinned public key verification on the client, and event-ID idempotency deduplication for replay protection.
4. **Durable Ingestion & Developer Tooling:** A checkpointed FastNEAR block poller with gap detection, an exponential retry queue with circuit breaking, durable PostgreSQL `JSONB` logs for gas-free historical replay, and zero-config local tunneling (`npx nearhook listen`).

---

## 3. User Stories
1. *As a Web3 merchant backend*, I want NearHook to follow cross-contract promise trees and verify terminal callback outcomes before dispatching, so that I never fulfill orders for payments that panicked and triggered an `ft_resolve_transfer` refund.
2. *As an autonomous AI agent engineer*, I want NearHook to push verified HTTP POST webhooks to my serverless agent endpoint, so that my agent can sleep at $0 idle compute cost and wake up only on verified on-chain events.
3. *As a cross-chain developer*, I want to subscribe to events on `intents.near` filtered by target chains (e.g., `["SOLANA", "BITCOIN"]`), receiving normalized JSON payloads when cross-chain intents settle on NEAR.
4. *As a local developer*, I want to run `npx nearhook listen --account "*.myapp.near" --forward http://localhost:3000/api/webhook`, so that I can develop and test my webhook handlers locally without configuring ngrok, SSL certificates, or router NAT rules.
5. *As a security engineer*, I want to verify webhook signatures against a pinned NearHook relayer public key and reject duplicate `X-NearHook-Id` headers, so that my backend is protected against payload tampering and replay attacks.
6. *As a developer debugging a failed local webhook*, I want to click "Replay" in the NearHook dashboard or run `nearhook replay <event_id>`, so that the exact historical payload is immediately re-dispatched to my endpoint without requiring me to re-sign or pay gas on-chain.
7. *As an infrastructure operator*, I want NearHook to automatically trip a circuit breaker (`PAUSED_UNHEALTHY`) for endpoints that persistently fail, so that dead client servers do not waste relayer network resources.

---

## 4. Implementation Decisions

### Monorepo Structure
- Managed by `pnpm` workspaces:
  - `packages/core`: Pure domain logic (Receipt DAG tracking, terminal settlement evaluator, DIP-4 NEP-297 parser, MPC signature parser, Ed25519 attestation and pinned verifier). Zero I/O dependencies.
  - `packages/engine`: FastNEAR checkpointed poller with gap detection, Redis ephemeral hot memory adapter, PostgreSQL / NeonDB client, HTTP delivery dispatcher, and circuit breaker.
  - `packages/tunnel-hub`: WebSocket relay server managing client tunnels and ring-buffer replay.
  - `packages/cli`: Standalone developer CLI (`nearhook listen`, `nearhook replay`).
  - `apps/dashboard`: Next.js web console with dark-mode developer UI, live DAG visualizer, and 1-click replay.

### Receipt Dependency Tracking Algorithm
- Traversal model:
  - Root receipt $v_{\text{root}}$ initiates the receipt graph.
  - Every vertex records: `receipt_id`, `predecessor_id`, `receiver_id`, `method_name`, `status`, `spawned_receipt_ids`, and `callback_dependencies`.
  - Transaction resolution condition:
    1. All discovered child promises have executed.
    2. All registered callbacks have executed.
    3. The block heights of all constituent receipts are confirmed in the indexer's contiguous checkpoint log.
- Domain settlement evaluation:
  - For NEP-141 / NEP-245 token transfers: Inspects `ft_resolve_transfer` callback return value and `ft_transfer` logs to distinguish `CONFIRMED` vs `REFUNDED`.

### Omnichain Clearinghouse Parsing
- Decodes DIP-4 logs with prefix `EVENT_JSON:{"standard":"dip4","event":"token_diff",...}` emitted by `intents.near`.
- Maps Omni-Bridge token contracts (`*.omft.near`) to canonical asset identifiers and formatted decimal amounts.
- Correlates `v1.signer` MPC signing requests with asynchronous return callbacks containing threshold `big_r` and `s` components.

### Cryptographic Attestation & Client Verification
- Relayer signs $M = \tau \parallel "." \parallel B$ with Ed25519 secret key.
- Dispatched headers: `X-NearHook-Id`, `X-NearHook-Timestamp`, `X-NearHook-Signature`.
- Client verification helper requires:
  1. Timestamp within 300-second freshness window.
  2. Idempotency store checking `X-NearHook-Id` to prevent replay attacks.
  3. Signature check strictly using **pinned relayer public key** (rejecting dynamically supplied headers).

### Ingestion Engine & Storage Schema
- FastNEAR poller:
  - Checkpointed block height stored in Redis/Postgres.
  - Gap detection: If latest block $> H_{\text{last}} + 1$, queues missing heights.
  - Supports `Optimistic` and `Final` finality modes.
- PostgreSQL / NeonDB tables:
  - `subscriptions`: Stores wildcard patterns (`*.app.near`), chain filters, destination URLs, status (`ACTIVE`, `PAUSED_UNHEALTHY`).
  - `deliveries`: Stores `event_id`, `tx_hash`, `payload` (`JSONB`), `http_status`, `attempt_count`, `latency_ms`.
- Exponential backoff retry intervals: 1s, 3s, 9s, 27s, 81s.
- Circuit breaker: Trips after 10 consecutive failures or $>95\%$ failure rate over 50 deliveries.

---

## 5. Testing Decisions & Test Seams

### Explicit Test Seams
1. **Receipt Tracker Seam (`@nearhook/core`):**
   - Pure function: `processReceiptOutcome(tree: InFlightReceiptTree, outcome: ExecutionOutcomeNode): ResolutionResult`.
   - Seam tests: Root execution, multi-shard promise chains, out-of-order receipt arrival, and callback resolution without network dependencies.
2. **Settlement Evaluator Seam (`@nearhook/core`):**
   - Pure function: `evaluateSettlementStatus(tree: InFlightReceiptTree): SettlementOutcome`.
   - Seam tests: Successfully completed payment, recipient panic handled by `ft_resolve_transfer` (refunded), and unhandled contract panic.
3. **Omnichain Parser Seam (`@nearhook/core`):**
   - Pure function: `parseClearinghouseEvents(logs: string[]): ClearinghouseSettlement | null`.
   - Seam tests: Mainnet DIP-4 JSON logs from `intents.near` and `v1.signer` MPC callbacks.
4. **Cryptographic Attestation & Idempotency Seam (`@nearhook/core`):**
   - Pure function: `verifyNearHookWebhook(options): Promise<{ valid: boolean; reason?: string }>`.
   - Seam tests: Valid signature with pinned key, tampered body, expired timestamp, forged public key rejection, and duplicate event ID replay rejection.
5. **FastNEAR Poller & Gap Detector Seam (`@nearhook/engine`):**
   - Mock HTTP server interface to verify block sequence progression, gap detection, and checkpoint updates.

---

## 6. Out of Scope
- Universal multi-chain indexing for external activity occurring entirely on foreign blockchains without passing through NEAR clearinghouses.
- Archival bulk data lake storage (NEAR Lake handles complete history).
- User key custody or automated transaction signing on behalf of users.

---

## 7. Further Notes & Benchmarking Targets
- Benchmarks must be measured using a reproducible multi-shard load generator and documented in a separate evaluation report with P50/P95/P99 latencies under varying transaction concurrency.
