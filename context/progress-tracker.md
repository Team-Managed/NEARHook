# NearHook: Progress Tracker

## 1. Project State & Phase
- **Current Phase:** Phase 1 (Core Domain Engine `@nearhook/core`) in progress.
- **Workflow Status:** Tickets 01, 02, 03, and 04 completed with 27 passing deterministic unit tests (`pnpm test`).

## 2. Completed Milestones

### Documentation & Specifications
- [x] `README.md`: Canonical open-source and hackathon documentation with badges, architecture diagrams, QuickNode comparison, CLI quickstart, dashboard wireframe, and Two-Way Webhooks.
- [x] `demo.md`: Complete end-to-end demo video script, storyboard, screen setup, and judge talking points covering merchant escrow, agent-safe quarantine, and two-way hook.
- [x] `LICENSE`: MIT License.
- [x] `whitepaper.md` (v2.7): Comprehensive, simplified whitepaper.
- [x] `docs/GLOSSARY.md`: Complete domain terminology.
- [x] `docs/specs/2026-11-11-nearhook-spec.md` (v2.0): Formal engineering specification.

### Architectural Decision Records (ADRs)
- [x] `ADR-001`: Modular Monorepo Architecture (`pnpm` workspaces).
- [x] `ADR-002`: Ephemeral Hot Memory (Redis 120s TTL) & Durable PostgreSQL.
- [x] `ADR-003`: Ed25519 Stateless Cryptographic Attestation & Key Pinning.
- [x] `ADR-004`: Two-Way Webhooks via Native NEAR `yield_create` and `yield_resume`.
- [x] `ADR-005`: Agent-Safe Mode and Prompt Injection Quarantine (`untrusted_metadata`).
- [x] `ADR-006`: Standardized Settlement Adapters (`NEP-141`, `NEP-245`, `DIP-4`) & Captured Receipt Replay.
- [x] `ADR-007`: Reference Demo Smart Contracts (`merchant-escrow` & `two-way-hook`) & Pre-compiled Bytecode Distribution.
- [x] `ADR-008`: Hybrid Developer CLI Tunnel Architecture & Interactive Terminal TUI.
- [x] `ADR-009`: Tri-State Settlement Semantics (`CONFIRMED` / `REFUNDED` / `PARTIALLY_REFUNDED`) & Granular Diagnostic Block.
- [x] `ADR-010`: Hybrid Ingestion Pipeline (WebSocket Push with Checkpointed Gap Detection).
- [x] `ADR-011`: Hosted Relayer for Autonomous Two-Way Webhook Resumption.
- [x] `ADR-012`: Dual-Level Agent-Safe Enforcement (Gateway & Local CLI).
- [x] `ADR-013`: Type Architecture (Branded TypeScript Primitives & Boundary Zod Validation).
- [x] `ADR-014`: Pure In-Memory DAG Stitcher Engine, Dynamic Completeness Resolution, and Gas Refund Pruning.

### Implementation Tickets (`docs/tickets/`)
- [x] **Ticket 01: Monorepo Setup & Core Domain Types** (Completed: `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/core/src/types/domain.ts`).
- [x] **Ticket 02: Pure DAG Stitcher & Gas Refund Pruning Engine** (Completed: `packages/core/src/stitcher/dag.ts`, unit tests in `packages/core/test/dag.test.ts`).
- [x] **Ticket 03: Settlement Adapters & Omnichain DIP-4 Parser** (Completed: `packages/core/src/adapters/nep141.ts`, `packages/core/src/adapters/dip4.ts`, `packages/core/src/evaluator/settlement.ts`, unit tests in `packages/core/test/settlement.test.ts`).
- [x] **Ticket 04: Ed25519 Attestation & Agent-Safe Mode Sanitizer** (Completed: `packages/core/src/crypto/attestation.ts`, `packages/core/src/crypto/verifier.ts`, `packages/core/src/agents/agent-safe.ts`, unit tests in `packages/core/test/crypto.test.ts` & `packages/core/test/agent-safe.test.ts`).
- [ ] `Ticket 05`: Captured Receipt Replay & CLI Trigger Driver (after Ticket 09 Testnet trace capture).
- [ ] **Ticket 06: Developer CLI Tunnel Listener (`nearhook listen`)** (In Progress: Full specification documented in `docs/tickets/06-developer-cli-tunnel-listener.md`).
- [ ] `Ticket 07`: FastNEAR Ingestion Poller & Durable Storage.
- [ ] `Ticket 08`: Temporal-Style Web Dashboard & SSE Live Stream.
- [ ] `Ticket 09`: Reference Demo Smart Contracts (Merchant Escrow & Two-Way Yield) — both contracts and sandbox coverage implemented; complete verification and capture provenance-bearing Testnet receipt traces.
- [ ] `Ticket 10`: NearHook Agent Skill Integration (`near/agent-skills`).

## 3. Next Step (Execution)
- Next: Review written spec for Ticket 06, write implementation plan with `writing-plans` skill, install CLI dependencies (`commander`, `ws`, `@types/ws`), and implement `packages/cli` following TDD.
