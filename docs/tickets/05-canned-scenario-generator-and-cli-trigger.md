# Ticket 05: Captured Receipt Replay and CLI Trigger

## Dependency

Complete Ticket 09 first. Its reference contract must be exercised on NEAR Testnet so the repository can include receipt traces captured from real transactions. Ticket 05 must not invent receipt outcomes or label synthetic data as real chain activity.

## Overview

Implement `nearhook trigger` as an offline replay tool for validated, provenance-bearing receipt fixtures. The CLI feeds captured outcomes through the real `@nearhook/core` DAG stitcher and settlement evaluator, then emits a clearly marked test webhook. It does not generate or hardcode expected business statuses.

Fixtures are recorded data, not production behavior. Each checked-in fixture must identify its source transaction, network, capture time, and format version. Developers can replay the exact trace without RPC calls after capture.

## Requirements

1. `packages/cli/src/fixtures/`:
   - Store versioned normalized receipt traces captured from Ticket 09 reference-contract transactions.
   - Include source metadata (`network`, `transaction_hash`, `captured_at`, and fixture version).
   - Do not fabricate runtime outcomes or patch in expected settlement results.
2. `packages/cli/src/commands/trigger.ts`:
   - Command: `nearhook trigger --fixture <path> [--forward <url>]`.
   - Validate fixture structure and provenance before processing; reject malformed or unsupported fixtures with a useful error.
   - Ingest the receipt outcomes through the real `@nearhook/core` DAG engine and derive settlement from those outcomes.
   - Mark every emitted payload as test data (`test_mode: true`) and use a test-only Ed25519 key. Never use a production relayer key for fixture replay.
   - Print the marked payload when `--forward` is omitted. Forward only when the user explicitly supplies `--forward`.
   - Do not contact NEAR RPC or FastNEAR during replay.
3. Keep the CLI runner generic: scenario names must not select hardcoded business statuses or bypass the core evaluator.

## Test Seams & Acceptance Criteria

- Tests use small synthetic receipt inputs only as unit-test setup, label them as synthetic, and execute them through the real core engine.
- At least one checked-in replay fixture is sourced from a real Ticket 09 Testnet transaction and retains its provenance.
- Replay derives the same settlement status as the captured trace when run repeatedly.
- Emitted output always includes `test_mode: true` and cannot be mistaken for a live delivery.
- Unknown fixture versions, invalid traces, and incomplete DAGs fail with a non-zero exit code and no forwarded request.
- Without `--forward`, the command performs no network request; with it, the command sends the marked test payload to the supplied URL.
