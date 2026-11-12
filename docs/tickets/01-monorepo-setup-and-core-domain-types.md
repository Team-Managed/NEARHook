# Ticket 01: Monorepo Setup and Core Domain Types

## Overview
Set up the multi-package `pnpm` monorepo configuration with strict TypeScript settings, and define the core domain types for NEAR receipt stitching, execution outcomes, and webhook payloads in `@nearhook/core`.

## Requirements
1. Monorepo root files:
   - `pnpm-workspace.yaml` configuring `packages/*` and `apps/*`.
   - `package.json` with scripts: `"build"`, `"test"`, `"typecheck"`.
   - `tsconfig.base.json` with `strict: true`, `noImplicitAny: true`, modern ES target.
2. `@nearhook/core` package:
   - `packages/core/package.json`
   - `packages/core/tsconfig.json`
   - `packages/core/src/types/domain.ts`:
     - `ReceiptId`: branded string
     - `TxHash`: branded string
     - `ExecutionStatus`: `SuccessValue(string)` | `SuccessReceiptId(string)` | `Failure(ActionError)`
     - `ExecutionOutcomeNode`: receipt metadata, predecessor, receiver, gas burnt, logs, child receipt IDs
     - `InFlightDAG`: graph representation with vertices, spawned set, executed set, and metadata
     - `SettlementStatus`: `protocol_status` (`SUCCESS` | `FAILURE`), `business_status` (`CONFIRMED` | `REFUNDED` | `PARTIALLY_REFUNDED` | `FAILED`)
     - `SettlementAmounts`: `transferred`, `settled`, `refunded`, `currency`
     - `SettlementDetails`: `resolver_method`, `raw_return_value`, `panicked_receipt_id`, `panic_reason`, `cross_shard_hops`, `total_gas_burnt` (ADR-009)
     - `CanonicalWebhookPayload`: complete attested payload structure

## Acceptance Criteria
- `pnpm build` and `pnpm typecheck` pass with zero errors.
- Zero `@ts-ignore`, `eslint-disable`, or `any`-casting.
- Pure TypeScript interfaces without I/O dependencies.

