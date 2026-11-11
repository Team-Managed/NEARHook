# NearHook: Code Standards & Engineering Rules

## 1. Type Safety & Compilations
- **Strict TypeScript Everywhere:**
  - `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.
  - Zero unapproved `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, or `any`-casting.
  - If a suppression is approved by user, it must be annotated inline with `// APPROVED-SUPPRESSION: <reason>`.
- **Package Management:**
  - Use `pnpm` workspaces for multi-package monorepos.

## 2. Architectural Boundaries & Decoupling
- **Pure Domain Functions vs Side-Effects:**
  - **Receipt DAG Math & Stitching Logic:** Pure functions taking `(current_state, new_receipt_outcome) -> next_state`. Completely decoupled from Redis/Postgres/HTTP to allow 100% deterministic unit testing.
  - **DIP-4 NEP-297 Parser:** Pure parser mapping raw log strings `EVENT_JSON:{...}` into canonical `OmnichainRoute` structures.
  - **Cryptographic Attestation:** Pure functions for message construction $M = \tau \parallel "." \parallel B$ and Ed25519 signing/verifying using `@noble/curves/ed25519` or TweetNaCl.
  - **IO / Drivers:** Dedicated adapters for Redis, PostgreSQL, FastNEAR HTTP client, and Axios/Fetch dispatcher.

## 3. Error Handling & Robustness
- **No Silent Failures:**
  - Catch blocks must never be empty or reduced to empty `console.log`.
  - Errors must be classified (e.g. `NetworkTransientError`, `ParseError`, `UnrecoverableError`) and propagated or handled meaningfully.
- **Circuit Breaker Discipline:**
  - Endpoints returning continuous 4xx/5xx errors must trigger circuit breaking to prevent DDoS-ing dead downstream servers.
- **Idempotency:**
  - Every event delivery must generate a deterministic `event_id` and handle duplicate delivery attempts safely.

## 4. Testing Discipline
- **No Fakes, No Skipped Tests:**
  - No `assert True`, empty test bodies, or skipped/xfail tests.
  - No hardcoded test responses (e.g. `if input == test: return expected`).
  - Unit tests must exercise real DAG combinations:
    1. Single-shard atomic receipt (root succeeds immediately).
    2. Multi-shard 3-block receipt tree (`intents.near` -> `omft` -> `v1.signer`).
    3. Failure in child promise triggering protocol refund (`ft_resolve_transfer` -> `FAILED_OR_REFUNDED`).
    4. Out-of-order block ingestion (shard 3 block arrives before shard 1 block).

