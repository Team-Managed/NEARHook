# NearHook: AI Workflow & Scoping Rules

## 1. Development Principles
1. **Scope Discipline:** Only touch files and components required for the current phase or milestone. Every change must be tracked and listed upon completion.
2. **Evidence Before Assertions:** Never claim a component is working or a test is passing without executing the code and verifying the actual output.
3. **No Unauthorized Dependencies:** Use existing tools and lean dependencies. Do not install heavy extraneous packages without approval.
4. **Progress Tracking:** Update `context/progress-tracker.md` after each meaningful implementation step.

## 2. Phased Roadmap Structure

### Phase 0: System Specification & Architecture Design (Current)
- Synthesize whitepaper into `context/*.md` specifications.
- Brainstorm core data schemas, DAG stitching algorithms, and CLI tunneling protocols.
- Write formal design spec in `docs/superpowers/specs/YYYY-MM-DD-nearhook-design.md` and get user approval.

### Phase 1: Core Domain Engine (`@nearhook/core`)
- TypeScript types: `ReceiptId`, `TxHash`, `ExecutionOutcomeNode`, `StitchedReceiptTree`, `OmnichainRoute`, `CanonicalWebhookPayload`.
- Ingestion models & FastNEAR block schemas.
- Pure DAG Stitcher:
  - In-flight state tracking.
  - Completeness invariant calculation: $\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$.
  - True terminal status resolution (handling refunds and ActionErrors).
- Omnichain Parsers:
  - DIP-4 / NEP-297 log parser (`intents.near`, `token_diff`, Omni-Bridge contract mapping).
  - MPC Chain Signatures parser (`v1.signer`, `derivation_path`, signature callback extraction).
- Ed25519 Attestation & Stateless Verifier:
  - Keypair generation, signing pre-image $M = \tau \parallel "." \parallel B$, signature verification.
- Comprehensive Unit Tests:
  - Normal multi-shard settlement.
  - Cross-shard child panic with refund callback.
  - Out-of-order receipt execution.
  - Omnichain DIP-4 parsing and token normalization.

### Phase 2: Ingestion Service & Durable Storage (`@nearhook/engine`)
- FastNEAR NEARDATA stream worker (`/v0/last_block/optimistic` & `/v0/block_opt/{height}`).
- Redis hot memory adapter:
  - Set operations (`SADD`, `SDIFF`), outcome caching (`HSET`), 60s TTL.
- PostgreSQL / NeonDB schema and database adapter:
  - Tables: `subscriptions`, `deliveries`.
  - Wildcard account matcher (`*.near`, `agent-*.app.near`).
- HTTP Webhook Dispatcher:
  - Outbound POST with exponential backoff & jitter (1s -> 3s -> 9s -> 27s -> 81s).
  - Circuit breaker logic (`PAUSED_UNHEALTHY`).

### Phase 3: Tunnel Hub & Developer CLI (`@nearhook/cli` & `@nearhook/tunnel-hub`)
- Tunnel Hub WebSocket Relay server:
  - Client authentication, session tokens.
  - In-memory circular ring-buffer for reconnect replay.
- Developer CLI tool:
  - `npx nearhook listen --account "*.near" --forward http://localhost:3000/api/webhook`.
  - Local Ed25519 signature verification.
  - CLI `replay <event_id>` command.

### Phase 4: Developer Web Dashboard (`@nearhook/dashboard`)
- Next.js web application with dark-mode developer UI.
- Live event stream (SSE / WebSockets).
- Interactive receipt tree DAG visualizer.
- Subscriptions manager with wildcard rule editor & circuit breaker controls.
- 1-click JSONB event replay & copyable curl/verification snippets.

