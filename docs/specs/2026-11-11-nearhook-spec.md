# NearHook Specification: Deterministic Cross-Shard Receipt Stitching, Omnichain Event Consolidation, and Zero-Config Tunneling

---

## 1. Problem Statement
Developers and autonomous AI agents building on NEAR Protocol or integrating cross-chain operations face a severe event-ingestion barrier:
1. **Nightshade Asynchronous Sharding & Optimistic Settlement Vulnerability:** A single NEAR transaction decomposes into a Directed Acyclic Graph (DAG) of cross-shard execution receipts spanning 2 to 4+ blocks. Naive indexers trigger callbacks when a root transaction is included at Block $B_t$, even though a child cross-contract promise may panic at Block $B_{t+1}$ and trigger a refund at Block $B_{t+2}$, causing downstream services or agents to release funds or merchandise prematurely.
2. **Fragmented Multi-Chain Ingestion:** Integrating 35+ blockchains (Bitcoin, Solana, Ethereum, Cosmos, etc.) requires maintaining separate, incompatible indexers, RPC pollers, and address formats.
3. **High Idle Compute Costs for Autonomous Agents:** AI agents must either run expensive continuous RPC polling loops (`while(true)`) or operate heavyweight AWS S3 Lake consumers, burning compute 24/7 even during idle periods.
4. **Local Development Friction:** Firewalls and NAT prevent cloud webhooks from reaching local developer machines (`localhost:3000`) without configuring third-party tunneling utilities (e.g. ngrok).

---

## 2. Solution
NearHook provides a dedicated, real-time event-push gateway and native local-tunneling protocol for NEAR:
1. **Stateful Cross-Shard Receipt Stitching:** Tracks in-flight receipt DAGs in ephemeral hot memory (Redis) and withholds webhook dispatch until the receipt completeness invariant $\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$ is met, computing true terminal status (`SUCCESS` vs `FAILED_OR_REFUNDED`).
2. **Omnichain Event Consolidation:** Indexes NEAR's decentralized clearinghouse contracts (`intents.near` DIP-4 / NEP-297 and `v1.signer` MPC Chain Signatures), normalizing 35+ chains into a unified, cryptographically signed HTTP webhook.
3. **Stateless Asymmetric Attestation:** Every webhook carries an Ed25519 signature from NearHook's relayer, verifiable in $<0.2\text{ms}$ with zero RPC calls.
4. **Zero-Config Local Tunneling & Network Repair:** A standalone CLI (`npx nearhook listen`) connects via WebSocket to the NearHook Tunnel Hub, streaming live events directly to local development servers with automatic exponential retry backoff, circuit breaking, and 1-click historical replay from PostgreSQL `JSONB` logs.

---

## 3. User Stories
1. *As a Web3 backend developer*, I want to subscribe to events on `intents.near` filtered by target chains (e.g., `["SOLANA", "BITCOIN"]`), so that I only receive normalized payloads when cross-chain swaps settle.
2. *As an autonomous AI agent engineer*, I want NearHook to push verified HTTP POST webhooks to my serverless agent endpoint, so that my agent can sleep at $0 idle compute cost and wake up only on verified on-chain events.
3. *As an e-commerce merchant dApp*, I want NearHook to withhold dispatching payment confirmation webhooks until all child receipts and refund callbacks have completed, so that I never fulfill orders for transactions that ultimately panicked and refunded.
4. *As a local developer*, I want to run `npx nearhook listen --account "*.myapp.near" --forward http://localhost:3000/api/webhook`, so that I can develop and test my webhook handlers locally without configuring ngrok, SSL certificates, or router NAT rules.
5. *As a security engineer*, I want to statelessly verify the `Ed25519` signature and timestamp of incoming webhooks using NearHook's public key, so that I can reject forged or replayed webhook requests without making external RPC calls.
6. *As a developer debugging a failed local webhook*, I want to click "Replay" in the NearHook dashboard or run `nearhook replay <event_id>`, so that the exact historical payload is immediately re-dispatched to my endpoint without requiring me to re-sign or pay gas on-chain.
7. *As a protocol operator*, I want NearHook to automatically trip a circuit breaker (`PAUSED_UNHEALTHY`) for endpoints that persistently fail, so that dead client servers do not waste relayer network resources.

---

## 4. Implementation Decisions

### Monorepo Structure
- Managed by `pnpm` workspaces:
  - `packages/core`: Pure domain logic (DAG stitching math, completeness calculator, DIP-4 NEP-297 parser, MPC signature parser, Ed25519 attestation and verification). Zero I/O dependencies.
  - `packages/engine`: FastNEAR NEARDATA stream consumer, Redis ephemeral hot memory adapter, PostgreSQL / NeonDB client, HTTP delivery dispatcher, and circuit breaker.
  - `packages/tunnel-hub`: WebSocket relay server managing client tunnels and ring-buffer replay.
  - `packages/cli`: Standalone developer CLI (`nearhook listen`, `nearhook replay`).
  - `apps/dashboard`: Next.js web console with dark-mode developer UI, live DAG visualizer, and 1-click replay.

### Receipt DAG Stitching Algorithm
- In-memory state in Redis (60-second TTL):
  - Set `tx:{hash}:spawned` stores all generated `ReceiptId`s.
  - Set `tx:{hash}:executed` stores all observed `ExecutionOutcomeWithId` IDs.
  - Completeness evaluated atomically: `SDIFF tx:{hash}:spawned tx:{hash}:executed`.
  - When the diff is empty, the DAG is stitched into a cohesive tree:
    - Analyzes every vertex for `ActionError`, panics, or system refund callbacks (`ft_resolve_transfer`).
    - Assigns terminal status `SUCCESS` or `FAILED_OR_REFUNDED`.

### Omnichain Normalization
- Decodes DIP-4 logs with prefix `EVENT_JSON:{"standard":"dip4","event":"token_diff",...}`.
- Maps Omni-Bridge token contracts (`*.omft.near`) to canonical chain IDs and calculates human-readable decimal balances.
- Decodes `v1.signer` MPC requests and correlates them with MPC signature return callbacks.

### Cryptographic Attestation
- Message pre-image: $M = \tau \parallel "." \parallel B$ (timestamp in seconds concatenated with dot and serialized JSON body).
- Signs using `@noble/curves/ed25519`.
- Inject headers: `X-NearHook-Id`, `X-NearHook-Timestamp`, `X-NearHook-Signature`, `X-NearHook-PubKey`.

### Storage & Resilience Schema
- PostgreSQL / NeonDB tables:
  - `subscriptions`: Stores wildcard patterns (`*.app.near`), chain filters, destination URLs, status (`ACTIVE`, `PAUSED_UNHEALTHY`).
  - `deliveries`: Stores `event_id`, `tx_hash`, `payload` (`JSONB`), `http_status`, `attempt_count`, `latency_ms`.
- Exponential backoff retry intervals: 1s, 3s, 9s, 27s, 81s.
- Circuit breaker: Trips after 10 consecutive failures or $>95\%$ failure rate over 50 deliveries.

---

## 5. Testing Decisions & Test Seams

### Explicit Test Seams
1. **DAG Stitcher Seam (`@nearhook/core`):**
   - Pure function: `processReceiptOutcome(state: InFlightTxState, outcome: ExecutionOutcomeNode): StitchingResult`.
   - Seam allows testing single-shard, multi-shard, out-of-order arrival, and refund detection without Redis or network mocking.
2. **Omnichain Parser Seam (`@nearhook/core`):**
   - Pure function: `parseOmnichainEvents(logs: string[]): OmnichainRoute | null`.
   - Tested against real mainnet DIP-4 log strings from `intents.near` and `v1.signer`.
3. **Cryptographic Attestation Seam (`@nearhook/core`):**
   - Pure functions: `signPayload(payload: object, secretKey: Uint8Array): AttestationHeaders` and `verifyNearHookSignature(headers, rawBody, publicKey): boolean`.
   - Tested with valid signatures, tampered payloads, expired timestamps, and malformed headers.
4. **Delivery Dispatcher Seam (`@nearhook/engine`):**
   - Mock HTTP server interface to verify real HTTP POST dispatch, status recording, and exponential retry calculation.
5. **Tunnel Hub & CLI Seam (`@nearhook/tunnel-hub` & `@nearhook/cli`):**
   - Local WebSocket connection test to verify outbound tunnel streaming, signature verification in the CLI, and forwarding to a mock local HTTP endpoint.

---

## 6. Out of Scope
- Building an on-chain validator or smart contract dispatcher (Wasm sandbox cannot open outbound TCP/HTTP sockets).
- S3 archive bulk storage (NEAR Lake already handles raw historical archival).
- Managing user private keys or executing transactions on behalf of users (NearHook is purely an ingress/push layer).

---

## 7. Further Notes
- NearHook is designed to operate on a continuous FastNEAR NEARDATA stream (`/v0/block_opt/{height}`) with typical block latency of 15–45ms.
- Autonomous AI agent frameworks (such as ElizaOS or LangChain) can plug directly into NearHook via a standardized `/webhook` endpoint with zero SDK dependencies.

