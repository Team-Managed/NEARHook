# NearHook: Project Overview

## 1. Product Definition
**NearHook** is a real-time event-push gateway and native local-tunneling protocol for NEAR Protocol. It bridges the gap between NEAR's advanced asynchronous execution primitives (Function Call Access Keys, hierarchical sub-accounts, NEAR Intents `intents.near`, and MPC Chain Signatures `v1.signer`) and off-chain consumers (dApps, microservices, and autonomous AI agents).

## 2. Core Problem Solved
Consuming events on NEAR introduces a critical correctness challenge: **Nightshade asynchronous sharding**. 
A single NEAR transaction decomposes into a Directed Acyclic Graph (DAG) of cross-shard execution receipts that resolve across 2 to 4+ consecutive blocks. Naive indexers and RPC pollers that trigger callbacks upon root transaction inclusion expose downstream systems to **Optimistic Settlement Vulnerabilities**, where a parent receipt succeeds at block $B_t$, but a child cross-contract promise panics at block $B_{t+1}$ and triggers a refund at block $B_{t+2}$.

NearHook solves this by correlating parent and child receipts in ephemeral hot memory (Redis) and withholding webhook dispatch until the entire receipt DAG reaches terminal completion.

## 3. Core Capabilities
1. **Stateful Cross-Shard Receipt Stitching:**
   - Tracks dynamic DAG $G_T = (V_T, E_T)$ where vertices are ReceiptIds and edges are spawned promises (`ExecutionOutcome.receipt_ids`).
   - Maintains the completeness invariant: $\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$.
   - Computes deterministic `TerminalStatus`: `SUCCESS` vs `FAILED_OR_REFUNDED`.

2. **Omnichain Event Consolidation (35+ Blockchains in One Pipe):**
   - Indexes NEAR's universal clearinghouses:
     - `intents.near` (DIP-4 / NEP-297 standards, `*.omft.near` multi-token diffs).
     - `v1.signer` (Threshold MPC Chain Signatures for Bitcoin, Ethereum, Solana, Cosmos, etc.).
   - Normalizes cross-chain settlements into a canonical, human-readable JSON payload.

3. **Cryptographic Attestation (Ed25519):**
   - Every payload is signed by NearHook's relayer key over canonical message $M = \tau \parallel "." \parallel B$.
   - Stateless verification by receivers in $<0.2\text{ms}$ with zero RPC calls.

4. **Zero-Config Local Tunneling & Network Repair:**
   - Outbound WebSocket relay (`npx nearhook listen`) pushes events to firewalled `localhost` without ngrok or third-party proxies.
   - Three-tier network repair:
     - Tier 1: Jittered exponential backoff retry queue (Redis).
     - Tier 2: Per-tunnel circular ring-buffer for instant replay on CLI reconnection.
     - Tier 3: 1-click durable PostgreSQL `JSONB` replay.

5. **Autonomous AI Agent Ingress:**
   - Scale-to-zero support: agents sleep at $0 idle compute cost and wake up upon receiving verified webhooks.

## 4. System Boundaries & Non-Goals
- **Non-Goals:**
  - NearHook is not an on-chain validator or smart contract dispatcher (Wasm sandbox cannot open outbound TCP/HTTP sockets).
  - NearHook does not duplicate NEAR Lake S3 archive storage; it is an optimized real-time push layer.
  - NearHook does not execute transaction signing for users; it delivers signed attestations of completed state transitions.

