# NearHook: Progress Tracker

## Current Status
- **Current Phase:** Phase 0: System Specification & Architecture Design (Completed with Matt Pocock Skills Framework)
- **Active Task:** User review of formal spec and tracer-bullet tickets before beginning Phase 1 implementation.

## Artifacts Generated (Matt Pocock Methodology)
- **Canonical Whitepaper:** [`whitepaper.md`](file:///c:/Users/Tyra/NEARhook/whitepaper.md)
- **Domain Modeling & Glossary:** [`docs/GLOSSARY.md`](file:///c:/Users/Tyra/NEARhook/docs/GLOSSARY.md)
- **Architecture Decision Records (ADRs):**
  - [`docs/adrs/ADR-001-modular-monorepo-architecture.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-001-modular-monorepo-architecture.md)
  - [`docs/adrs/ADR-002-ephemeral-hot-memory-and-durable-postgres.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-002-ephemeral-hot-memory-and-durable-postgres.md)
  - [`docs/adrs/ADR-003-ed25519-stateless-attestation.md`](file:///c:/Users/Tyra/NEARhook/docs/adrs/ADR-003-ed25519-stateless-attestation.md)
- **Formal Feature Specification (`/to-spec`):**
  - [`docs/specs/2026-11-11-nearhook-spec.md`](file:///c:/Users/Tyra/NEARhook/docs/specs/2026-11-11-nearhook-spec.md)
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
- [x] Initialized `context/` documentation suite:
  - [x] `context/project-overview.md`
  - [x] `context/architecture-context.md`
  - [x] `context/ui-context.md`
  - [x] `context/code-standards.md`
  - [x] `context/ai-workflow-rules.md`
  - [x] `context/progress-tracker.md`
- [x] Socratic alignment & ADRs (`grill-with-docs`)
- [x] Generated formal spec (`to-spec`)
- [x] Broken down into dependency-tracked tracer-bullet tickets (`to-tickets`)

### Phase 1: Core Domain Engine (`@nearhook/core`)
- [ ] Ticket 01: Monorepo setup and core domain types
- [ ] Ticket 02: Pure DAG stitcher and true terminal status evaluator
- [ ] Ticket 03: Omnichain DIP-4 and MPC Chain Signature parsers
- [ ] Ticket 04: Ed25519 cryptographic attestation & stateless verifier

### Phase 2: Ingestion Service, Storage & Webhook Dispatcher (`@nearhook/engine`)
- [ ] Ticket 05: FastNEAR stream consumer and Redis hot memory adapter
- [ ] Ticket 06: PostgreSQL storage and webhook delivery dispatcher with circuit breaker

### Phase 3: Tunnel Hub Relay & CLI (`@nearhook/cli` & `@nearhook/tunnel-hub`)
- [ ] Ticket 07: WebSocket Tunnel Hub and developer CLI (`npx nearhook listen`)

### Phase 4: Developer Web Dashboard (`@nearhook/dashboard`)
- [ ] Ticket 08: Developer web dashboard and live DAG visualizer


