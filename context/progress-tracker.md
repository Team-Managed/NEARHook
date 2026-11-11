# NearHook: Progress Tracker

## Current Status
- **Current Phase:** Phase 0: Architecture Revision (Incorporating Rigorous Technical Review)
- **Active Task:** Completed architectural overhaul of `whitepaper.md`, `docs/specs/`, `docs/GLOSSARY.md`, `docs/adrs/`, and `docs/tickets/`. Ready for implementation.

## Architectural Changes Implemented (v2.0)
1. **Receipt Graph & Settlement Semantics:**
   - Replaced naive set-difference formula with explicit Receipt Dependency Graph ($G_T = (V_T, E_T)$) tracking root receipts, promise spawns, and callback dependencies.
   - Replaced naive failure classification with dual-axis settlement evaluation (`protocol_status` vs `business_status`).
   - Fixed refund detection: correctly models NEP-141 `ft_resolve_transfer` contract callbacks and return values rather than assuming `predecessor_id == "system"`.
2. **Omnichain Ingress Scoping:**
   - Accurately scoped to NEAR-mediated clearinghouse events (`intents.near` and `v1.signer` MPC threshold signatures); removed claims of universal 35-chain indexing replacement.
3. **Checkpointed FastNEAR Poller:**
   - Correctly positioned FastNEAR as an HTTP polling API with contiguous block checkpoints and gap detection.
4. **Complete Webhook Security:**
   - Mandated client-side public key pinning to prevent relayer spoofing.
   - Added event-ID idempotency deduplication to prevent replay attacks within the 300s freshness window.
5. **Empirical Benchmarking Plan:**
   - Clarified preliminary latency figures as architectural design targets with a formal multi-shard test harness plan.

## Artifacts Generated & Maintained
- **Technical Whitepaper (v2.0):** [`whitepaper.md`](file:///c:/Users/Tyra/NEARhook/whitepaper.md)
- **Domain Modeling & Glossary:** [`docs/GLOSSARY.md`](file:///c:/Users/Tyra/NEARhook/docs/GLOSSARY.md)
- **Architecture Decision Records:**
  - [`docs/adrs/ADR-001-modular-monorepo-architecture.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-001-modular-monorepo-architecture.md)
  - [`docs/adrs/ADR-002-ephemeral-hot-memory-and-durable-postgres.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-002-ephemeral-hot-memory-and-durable-postgres.md)
  - [`docs/adrs/ADR-003-ed25519-stateless-attestation.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-003-ed25519-stateless-attestation.md)
- **Formal Feature Specification (`/to-spec`):** [`docs/specs/2026-11-11-nearhook-spec.md`](file:///c:/Users/Tyra/NEARhook/docs/specs/2026-11-11-nearhook-spec.md)
- **Tracer-Bullet Implementation Tickets (`/to-tickets`):**
  - [`docs/tickets/01-monorepo-setup-and-core-types.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/01-monorepo-setup-and-core-types.md)
  - [`docs/tickets/02-pure-dag-stitcher-and-terminal-evaluator.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/02-pure-dag-stitcher-and-terminal-evaluator.md)
  - [`docs/tickets/03-omnichain-dip4-and-mpc-parsers.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/03-omnichain-dip4-and-mpc-parsers.md)
  - [`docs/tickets/04-ed25519-cryptographic-attestation.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/04-ed25519-cryptographic-attestation.md)
  - [`docs/tickets/05-fastnear-stream-and-redis-hot-memory.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/05-fastnear-stream-and-redis-hot-memory.md)
  - [`docs/tickets/06-postgres-storage-and-webhook-dispatcher.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/06-postgres-storage-and-webhook-dispatcher.md)
  - [`docs/tickets/07-websocket-tunnel-hub-and-nearhook-cli.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/07-websocket-tunnel-hub-and-nearhook-cli.md)
  - [`docs/tickets/08-developer-dashboard-and-dag-visualizer.md`](file:///c:/Users/Tyra/NEARhook/docs/tickets/08-developer-dashboard-and-dag-visualizer.md)

## Roadmap & Milestones

### Phase 0: Specification & System Design
- [x] Initialized `context/` documentation suite
- [x] Socratic alignment & ADRs (`grill-with-docs`)
- [x] Generated formal spec (`to-spec`)
- [x] Broken down into dependency-tracked tracer-bullet tickets (`to-tickets`)
- [x] Technical architecture revision (v2.0) incorporating honest review

### Phase 1: Core Domain Engine (`@nearhook/core`)
- [ ] Ticket 01: Monorepo setup and core domain types
- [ ] Ticket 02: Receipt dependency tracker and dual-axis settlement evaluator
- [ ] Ticket 03: Omnichain DIP-4 and MPC Chain Signature parsers
- [ ] Ticket 04: Ed25519 cryptographic attestation with key pinning and idempotency

### Phase 2: Ingestion Service, Storage & Webhook Dispatcher (`@nearhook/engine`)
- [ ] Ticket 05: Checkpointed FastNEAR poller and Redis hot memory adapter
- [ ] Ticket 06: PostgreSQL storage and webhook delivery dispatcher with circuit breaker

### Phase 3: Tunnel Hub Relay & CLI (`@nearhook/cli` & `@nearhook/tunnel-hub`)
- [ ] Ticket 07: WebSocket Tunnel Hub and developer CLI (`npx nearhook listen`)

### Phase 4: Developer Web Dashboard (`@nearhook/dashboard`)
- [ ] Ticket 08: Developer web dashboard and live DAG visualizer
