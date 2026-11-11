# NearHook: Progress Tracker

## 1. Project State & Phase
- **Current Phase:** Phase 0 (Design & Architecture) completed $\rightarrow$ Transitioning to Phase 1 (Core Domain Engine).
- **Whitepaper Status:** Canonical v2.7 released (`whitepaper.md`).

## 2. Completed Milestones

### Documentation & Specifications
- [x] `whitepaper.md` (v2.7): Comprehensive, simplified whitepaper with:
  - The QuickNode vs NearHook core distinction and 5-step demo flow.
  - Master end-to-end architecture diagram including PostgreSQL & Developer Dashboard.
  - Two-Way Webhooks via native NEAR `yield_create` and `yield_resume`.
  - Developer Tooling: `nearhook listen` & `nearhook trigger` (The Stripe CLI for NEAR).
  - Agent-Safe Mode: Prompt injection defense & dust filtering for autonomous AI agents.
  - Standardized Settlement Adapters (`NEP-141`, `NEP-245`, `DIP-4`, `v1.signer`).
  - Updated block times (~600ms) and FastNEAR real-time pipeline.
- [x] `docs/GLOSSARY.md`: Complete domain terminology.
- [x] `docs/adrs/ADR-001-modular-monorepo-architecture.md`: pnpm workspace structure.
- [x] `docs/adrs/ADR-002-ephemeral-hot-memory-and-durable-postgres.md`: FastNEAR ingestion + two-tier storage (Redis 120s TTL + PostgreSQL/NeonDB).
- [x] `docs/adrs/ADR-003-ed25519-stateless-attestation.md`: Cryptographic attestation with public key pinning & event-ID idempotency deduplication.
- [x] `docs/specs/2026-11-11-nearhook-spec.md`: Detailed engineering specification.

### Architecture & Optimization Decisions
- [x] **FastNEAR `tx_hash` Integration:** Verified FastNEAR Neardata injects `tx_hash` into `receipt_execution_outcomes`.
- [x] **Root-Registered Completion Guard:** Enforces `root_registered == 1` before evaluating the set-difference completeness trigger.
- [x] **System Gas Refund Pruning:** Shaves ~600ms (1 full block roundtrip) off delivery by pruning pure system gas refunds.
- [x] **Standardized Settlement Adapters:** Explicitly models NEP-141, NEP-245, and DIP-4 business refund conditions.
- [x] **Two-Way Hooks Architecture:** Leverages NEAR native `yield_create` and `yield_resume` to enable smart contracts to await webhook responses.
- [x] **Agent-Safe Mode:** Shields autonomous agents against prompt injection and dust token exhaustion.
- [x] **Real-Time Connecting Pipeline:** Formally documented the 4-channel pipeline connecting FastNEAR shard ingestion, live Server-Sent Events (SSE) to the Temporal-style dashboard canvas, PostgreSQL durable persistence, and WebSocket tunneling to `localhost:3000`.

## 3. Next Steps (Phase 1: `@nearhook/core`)
- [ ] Initialize monorepo workspace configuration (`pnpm-workspace.yaml`, `package.json`, `tsconfig.json`).
- [ ] Define core TypeScript domain types (`ReceiptId`, `TxHash`, `ExecutionOutcomeNode`, `StitchedReceiptTree`, `CanonicalWebhookPayload`).
- [ ] Implement pure Receipt DAG Stitcher with gas refund pruning and root guard invariant.
- [ ] Implement NEP-141, NEP-245, and DIP-4 settlement adapters.
- [ ] Implement `nearhook trigger` canned event generator for local testing.
- [ ] Implement native Node.js Ed25519 signer and verifier (`node:crypto`).
- [ ] Comprehensive unit tests verifying real multi-shard DAG permutations without hardcoded outputs or mock bypasses.

