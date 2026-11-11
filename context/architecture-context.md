# NearHook: Architecture Context

## 1. System Topology & Subsystems

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                      NEAR PROTOCOL (NIGHTSHADE SHARDS)                      │
 │     Shard 0 (Signatures)        Shard 1 (Intents)       Shard 2/3 (Tokens)  │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ FastNEAR NEARDATA Stream
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                      INGESTION & STITCHER ENGINE                            │
 │  1. Stream Worker: Polls /v0/last_block/optimistic & /v0/block_opt/{height}  │
 │  2. Receipt Parser: Extracts ExecutionOutcomeWithId, logs, spawned receipt_ids│
 │  3. Redis Hot Memory (Ephemerality: 60s TTL):                               │
 │     • SADD tx:{hash}:spawned <id...>                                        │
 │     • SADD tx:{hash}:executed <id...>                                       │
 │     • HSET tx:{hash}:outcomes <id> <serialized_outcome>                     │
 │     • SDIFF tx:{hash}:spawned tx:{hash}:executed == empty => TRIGGER STITCH │
 │  4. Omnichain Normalizer: Decodes DIP-4 token_diff and MPC signatures       │
 │  5. Attestation Engine: Ed25519 signs canonical payload M = timestamp . body│
 └──────────────────────┬───────────────────────────────┬──────────────────────┘
                        │ Final Stitched Payload        │
                        ▼                               ▼
 ┌──────────────────────────────────────┐     ┌────────────────────────────────┐
 │     DURABLE STORE & DISPATCHER       │     │       TUNNEL HUB RELAY         │
 │  • PostgreSQL (NeonDB):              │     │  • WebSocket Hub Server        │
 │    - subscriptions (filters, URLs)   │     │  • Authenticated CLI sessions  │
 │    - deliveries (status, JSONB)      │     │  • In-memory ring-buffer       │
 │  • HTTP Dispatcher with Retry Queue  │     │  • Instant forward to:         │
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

### Invariant 1: Stitching Completeness Invariant
$$\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$$
No event payload for transaction $T$ shall ever be dispatched or published until all spawned receipt IDs across all shards have a recorded `ExecutionOutcome`.

### Invariant 2: True Terminal Status Invariant
$$\text{TerminalStatus}(T) = \begin{cases} \texttt{FAILED\_OR\_REFUNDED} & \text{if } \exists v \in V_T_{\text{primary}} : \text{status}(v) = \texttt{Failure} \lor \text{is\_refund}(v) \\ \texttt{SUCCESS} & \text{otherwise} \end{cases}$$
If any execution outcome in the dependency tree panics, returns an `ActionError`, or emits a refund callback (`predecessor_id == "system"` or `ft_resolve_transfer`), the settlement is flagged `FAILED_OR_REFUNDED`.

### Invariant 3: Cryptographic Nonce & Signature Invariant
Every dispatched payload must include:
- `X-NearHook-Id`: Unique event ID (`evt_<cuid2>`).
- `X-NearHook-Timestamp`: Unix epoch seconds ($\tau$).
- `X-NearHook-Signature`: `ed25519:<hex>` where $\sigma = \text{Ed25519\_Sign}_{sk}(\tau \parallel "." \parallel \text{JSON})$.
- `X-NearHook-PubKey`: `ed25519:<base58_public_key>`.
Stateless verifiers reject any request where $|\text{now}() - \tau| > 300\text{s}$.

### Invariant 4: Circuit Breaker Invariant
If an external endpoint fails $\ge 10$ consecutive deliveries or maintains a failure rate $> 95\%$ over 50 attempts, its status is updated to `PAUSED_UNHEALTHY` to protect outbound relayer resources.

## 3. Data Storage Model

### Redis (Hot Ephemeral Store, TTL: 60s)
- `nearhook:block:last_height`: String storing integer of latest processed block.
- `nearhook:tx:{hash}:spawned`: Set of all spawned `ReceiptId`s.
- `nearhook:tx:{hash}:executed`: Set of all executed `ReceiptId`s.
- `nearhook:tx:{hash}:meta`: Hash storing root sender, receiver, block bounds, timestamps.
- `nearhook:tx:{hash}:nodes`: Hash mapping `ReceiptId -> JSON(OutcomeNode)`.
- `nearhook:tx:{hash}:edges`: List of directed edges `[from_id, to_id]`.
- `nearhook:tunnel:{session_id}:buffer`: Circular ring-buffer of last $N$ unacknowledged events.

### PostgreSQL / NeonDB (Durable State)
- `subscriptions`:
  - `id`: string (UUID or prefix `sub_...`)
  - `user_id`: string
  - `account_filter`: string (e.g. `*.app.near`, `intents.near`)
  - `chain_filter`: text[] (e.g. `['SOLANA', 'BITCOIN', 'ETHEREUM']`)
  - `event_type_filter`: text[]
  - `destination_url`: string nullable (for Webhook mode)
  - `secret_key`: string (optional symmetric shared secret in addition to relayer Ed25519)
  - `status`: enum (`ACTIVE`, `PAUSED_MANUAL`, `PAUSED_UNHEALTHY`)
  - `created_at`: timestamptz
- `deliveries`:
  - `id`: string (`evt_...`)
  - `subscription_id`: string FK
  - `tx_hash`: string
  - `event_type`: string
  - `terminal_status`: string
  - `payload`: jsonb (Full canonical stitched event)
  - `http_status`: int nullable
  - `attempt_count`: int
  - `latency_ms`: int nullable
  - `created_at`: timestamptz

