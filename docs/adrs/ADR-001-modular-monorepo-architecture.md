# ADR-001: Modular Monorepo Architecture via pnpm Workspaces

## Status
Accepted

## Context
NearHook requires multiple independent components:
1. Pure mathematical DAG stitching engine and omnichain parsers.
2. Ingestion service consuming FastNEAR NEARDATA and managing database persistence.
3. Outbound HTTP webhook delivery engine with exponential retry queues and circuit breaker.
4. WebSocket Tunnel Hub relay for local developers.
5. Standalone developer CLI (`npx nearhook listen`, `replay`).
6. Developer Web Console / Dashboard.

The host development machine runs Node.js v24.12.0 and pnpm v11.15.1. Rust and Docker are not locally installed.

## Decision
We adopt a **Modular Monorepo architecture managed by pnpm workspaces**:
- `packages/core`: Pure TypeScript domain logic (DAG mathematics, completeness calculation, DIP-4/MPC parsers, Ed25519 signing and verification). **Zero external I/O dependencies.**
- `packages/engine`: FastNEAR HTTP streamer, Redis hot memory client, PostgreSQL (NeonDB) client, HTTP delivery dispatcher, and circuit breaker.
- `packages/tunnel-hub`: Lightweight WebSocket relay server.
- `packages/cli`: Standalone CLI tool published to npm (`nearhook`).
- `apps/dashboard`: Next.js web console with dark-mode developer UI, live DAG visualizer, and 1-click replay.

## Consequences
- **Positive:**
  - Strict decoupling: `@nearhook/core` is 100% testable without database mocks or network connections.
  - Shared TypeScript types between the engine, CLI, and dashboard ensure zero schema drift.
  - Fast developer feedback loop and immediate compatibility with native Node.js v24 environment.
- **Negative:**
  - Cross-package dependencies require careful build ordering (handled cleanly by pnpm).

