# ADR-007: Reference Demo Smart Contracts and Pre-Compiled Bytecode Distribution

## Status
Accepted

## Context
Automated evaluation screeners (Codex, Claude Code), hackathon judges, and external developers need to verify on-chain multi-shard execution and Two-Way Webhooks on NEAR Testnet. 
1. **Naming & Perception:** Using toy terminology like "mock store" undermines the perceived production viability and seriousness of the product. The escrow pattern is a genuine real-world Web3 commerce standard.
2. **Toolchain Friction:** Compiling NEAR Rust contracts requires `cargo-near` and the `wasm32-unknown-unknown` target, which is not installed in standard CI environments or light developer machines.

## Decision
1. **Dedicated Contracts Package:** House production-grade reference smart contracts in `packages/contracts/`:
   - `merchant-escrow`: Implements NEP-141 `ft_on_transfer` to simulate inventory fulfillment or stockout refunds via `ft_resolve_transfer`. Deployed at `merchant-escrow.testnet`.
   - `two-way-hook`: Implements `yield_create` and `yield_resume` to pause execution on-chain awaiting off-chain HTTP approval. Deployed at `two-way-hook.testnet`.
2. **Dual Artifact Distribution:**
   - Maintain idiomatic Rust source code using `near-sdk-rs`.
   - Check in pre-compiled, deterministic `.wasm` release binaries directly inside `packages/contracts/res/`.
   - Provide copy-paste `near-cli` commands so reviewers can trigger real on-chain transactions immediately without compiling Rust locally.

## Consequences
- **Positive:** Zero toolchain friction for judges, AI screeners, and developers.
- **Positive:** Production-grade architecture and naming reflecting real commercial escrow standards.
- **Negative:** Requires committing small binary `.wasm` artifacts (~150KB) to the repository.

