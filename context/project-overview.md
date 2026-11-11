# NearHook: Project Overview

## 1. Product Definition
**NearHook** is a developer-first, receipt-aware event delivery gateway and local tunneling tool for NEAR Protocol. It bridges the gap between NEAR's asynchronous Nightshade execution environment and off-chain consumers (dApps, microservices, and autonomous AI agents).

## 2. Core Problem Solved
Consuming events on NEAR introduces a critical correctness challenge: **Nightshade asynchronous sharding**. 
A single NEAR transaction decomposes into an asynchronous tree of cross-shard execution receipts that resolve across 2 to 4+ consecutive blocks. Naive indexers and RPC pollers that trigger callbacks upon root transaction inclusion expose downstream systems to **Optimistic Settlement Vulnerabilities**, where a parent receipt succeeds at block $B_t$, but a child cross-contract promise panics at block $B_{t+1}$ and triggers a refund callback at block $B_{t+2}$.

NearHook solves this by:
1. Tracking the full receipt dependency graph (parent promises, callback dependencies, and contiguous block confirmations).
2. Distinguishing protocol execution status from business settlement outcomes (e.g. evaluating NEP-141 `ft_resolve_transfer` callback return values rather than naively failing transactions with handled panics).

## 3. Core Capabilities
1. **Asynchronous Receipt Dependency Tracking:**
   - Tracks dynamic DAG $G_T = (V_T, E_T)$ where vertices are ReceiptIds and edges represent promise spawns and callback dependencies.
   - Enforces terminal resolution conditions before event dispatch.
   - Evaluates dual-axis status: `protocol_status` (`SUCCESS` vs unhandled `FAILURE`) and `business_status` (`CONFIRMED` vs `REFUNDED`).

2. **NEAR Clearinghouse Event Ingress:**
   - Ingress for cross-chain activity settling on NEAR:
     - `intents.near` (NEP-297 / DIP-4 event logs, Omni-Bridge token diffs).
     - `v1.signer` (Threshold MPC Chain Signatures for Bitcoin, Ethereum, Solana, etc.).
   - Normalizes clearinghouse state transitions into a structured, human-readable JSON payload.

3. **Cryptographically Attested Delivery:**
   - Every payload is signed with an Ed25519 relayer key over canonical message $M = \tau \parallel "." \parallel B$.
   - Receiver verification requires **public key pinning** and **event-ID idempotency deduplication** to defeat relayer spoofing and replay attacks.

4. **Durable Ingestion & Developer Tooling:**
   - Checkpointed FastNEAR block poller with gap detection.
   - Jittered exponential backoff retry queue with automated circuit breaking.
   - 1-click durable PostgreSQL `JSONB` replay.
   - Zero-config local tunneling (`npx nearhook listen`).

## 4. System Boundaries & Non-Goals
- **Non-Goals:**
  - NearHook is not a universal indexer for arbitrary activity occurring entirely on external blockchains (it monitors NEAR-mediated clearinghouse settlements).
  - NearHook does not duplicate NEAR Lake S3 archival bulk storage.
  - NearHook does not hold user private keys or execute transactions on behalf of users.
