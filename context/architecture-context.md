# NearHook: Architecture Context

## 1. System Topology & Subsystems

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                      NEAR PROTOCOL (NIGHTSHADE SHARDS)                      │
 │     Shard 0 (Signatures)        Shard 1 (Intents)       Shard 2/3 (Tokens)  │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ FastNEAR HTTP Chunk Poller
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                      INGESTION & RECEIPT TRACKER ENGINE                     │
 │  1. Checkpointed Poller: Gap detection across /v0/block_opt/{height}         │
 │  2. Receipt Parser: Extracts ExecutionOutcomeWithId, logs, spawned receipts  │
 │  3. In-Memory / Redis Tracker:                                              │
 │     • Tracks root receipts, promise spawns, and callback dependencies       │
 │     • Evaluates terminal resolution against contiguous block checkpoint     │
 │  4. Settlement Evaluator: Inspects ft_resolve_transfer callbacks & NEP-297 │
 │  5. Clearinghouse Normalizer: Decodes DIP-4 token_diff and MPC signatures   │
 │  6. Attestation Engine: Ed25519 signs canonical payload M = timestamp . body│
 └──────────────────────┬───────────────────────────────┬──────────────────────┘
                        │ Final Stitched Payload        │
                        ▼                               ▼
 ┌──────────────────────────────────────┐     ┌────────────────────────────────┐
 │     DURABLE STORE & DISPATCHER       │     │       TUNNEL HUB RELAY         │
 │  • PostgreSQL (NeonDB):              │     │  • WebSocket Hub Server        │
 │    - subscriptions (filters, URLs)   │     │  • Authenticated CLI sessions  │
 │    - deliveries (status, JSONB)      │     │  • In-memory ring-buffer       │
 │  • HTTP Dispatcher with Retry Queue  │     │  • Local delivery via:         │
 │    (Exponential Backoff + Jitter)    │     │    localhost:PORT via CLI      │
 │  • Circuit Breaker (PAUSED_UNHEALTHY)│     └────────────────────────────────┘
 └──────────────────────┬───────────────┘
                        │
                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                           CONSUMPTION TARGETS                               │
 │  • Cloud HTTPS Webhooks (Next.js, FastAPI, Cloudflare Workers, AWS Lambda)   │
 │  • Local CLI Client (`npx nearhook listen --forward http://localhost:3000`) │
 │  • Sleeping AI Agents (ElizaOS, LangChain, MCP Agent `/wakeup` endpoints)   │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## 2. Invariants & Correctness Guarantees

### Invariant 1: Terminal Receipt Dependency Resolution
A transaction $T$ is eligible for webhook dispatch if and only if:
1. The root receipt $v_{\text{root}}$ has executed.
2. All discovered child promises have executed.
3. All registered callback dependencies have executed.
4. The block heights of all constituent receipts are confirmed in the indexer's contiguous checkpoint log.

### Invariant 2: Dual-Axis Settlement Evaluation
The payload must report two distinct statuses:
- `protocol_status`: `SUCCESS` if no unhandled runtime panics occurred; `FAILURE` otherwise.
- `business_status`: `CONFIRMED` if the primary business operation succeeded; `REFUNDED` if handled via a resolver callback (e.g. `ft_resolve_transfer` returning refunded amount).

### Invariant 3: Pinned Relayer Key & Idempotency Invariant
Every dispatched payload carries:
- `X-NearHook-Id`: Unique event ID.
- `X-NearHook-Timestamp`: Unix epoch seconds ($\tau$).
- `X-NearHook-Signature`: `ed25519:<hex>` where $\sigma = \text{Ed25519\_Sign}_{sk}(\tau \parallel "." \parallel \text{JSON})$.

Receiving endpoints must verify against a **pinned public key** (ignoring dynamic headers) and enforce **event-ID deduplication** within the 300s freshness window.

### Invariant 4: Circuit Breaker Invariant
If an external endpoint fails $\ge 10$ consecutive deliveries or maintains a failure rate $> 95\%$ over 50 attempts, its status is updated to `PAUSED_UNHEALTHY` to protect outbound relayer resources.

## 3. Data Storage Model

### Redis (Hot Ephemeral Store, Configurable TTL: 120s)
- `nearhook:checkpoint:height`: String storing integer of latest contiguous processed block height.
- `nearhook:tx:{hash}:tracker`: Hash storing root sender, receiver, block bounds, and pending receipt/callback dependency counts.
- `nearhook:tx:{hash}:nodes`: Hash mapping `ReceiptId -> JSON(OutcomeNode)`.
- `nearhook:tunnel:{session_id}:buffer`: Circular ring-buffer of unacknowledged events.

### PostgreSQL / NeonDB (Durable State)
- `subscriptions`:
  - `id`: string (UUID or prefix `sub_...`)
  - `account_filter`: string (e.g. `*.app.near`, `intents.near`)
  - `chain_filter`: text[] (e.g. `['SOLANA', 'BITCOIN', 'ETHEREUM']`)
  - `destination_url`: string
  - `status`: enum (`ACTIVE`, `PAUSED_MANUAL`, `PAUSED_UNHEALTHY`)
  - `created_at`: timestamptz
- `deliveries`:
  - `id`: string (`evt_...`)
  - `subscription_id`: string FK
  - `tx_hash`: string
  - `protocol_status`: string
  - `business_status`: string
  - `payload`: jsonb (Full canonical stitched event)
  - `http_status`: int nullable
  - `attempt_count`: int
  - `latency_ms`: int nullable
  - `created_at`: timestamptz
