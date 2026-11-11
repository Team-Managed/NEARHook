# NearHook: Deterministic Cross-Shard Receipt Stitching, Omnichain Event Consolidation, and Zero-Config Tunneling for NEAR Protocol

**Technical Whitepaper**  
**Version:** 1.0.0  
**Date:** November 2026  
**Category:** Core Developer Infrastructure / Chain Abstraction / Autonomous Agent Ingress  
**Status:** Canonical Design Document  

---

## Executive Summary

Modern decentralized applications, off-chain microservices, and autonomous AI agents operate as continuous state machines: they observe state transitions on-chain, execute business or reasoning logic off-chain, and submit signed transactions back to the network. While NEAR Protocol has engineered advanced primitives for the *execution* and *signing* phases of this loop—specifically Function Call Access Keys, hierarchical sub-accounts, NEAR Intents (`intents.near`), and Multi-Party Computation (MPC) Chain Signatures (`v1.signer`)—it lacks a native, low-latency, developer-friendly **event-ingestion layer**.

Furthermore, consuming events on NEAR introduces a fundamental correctness challenge absent in single-block atomic execution environments like Ethereum or Solana: **Nightshade asynchronous sharding**. On NEAR, a single transaction decomposes into a Directed Acyclic Graph (DAG) of cross-shard execution receipts (`Receipt`) that resolve across 2 to 4+ consecutive blocks. Naive indexers and RPC pollers that trigger callbacks upon root transaction inclusion expose downstream systems to **Optimistic Settlement Vulnerabilities**, where a parent receipt succeeds at block $B_t$, but a child promise panics at block $B_{t+1}$ and triggers a protocol refund at block $B_{t+2}$.

This paper introduces **NearHook**, a real-time event-push gateway and native local-tunneling protocol for NEAR Protocol. NearHook solves three foundational infrastructure problems:

1. **Stateful Cross-Shard Receipt Stitching:** NearHook correlates parent and child receipts across shards in low-latency ephemeral memory (Redis) and withholds event dispatch until the entire receipt tree satisfies the **Completeness Invariant** ($\Delta(T) = \emptyset$). It evaluates the true terminal status of the execution tree, guaranteeing that panics, promise failures, and protocol refunds are never optimistically misreported as successful settlements.
2. **Omnichain Event Consolidation (35+ Blockchains in One Stream):** By indexing NEAR’s universal cross-chain clearinghouse contracts (`intents.near` and `v1.signer`), NearHook normalizes settlements spanning Bitcoin, Ethereum, Solana, Dogecoin, Cosmos, TON, XRP, and EVM Layer-2s into a single, standardized, cryptographically signed (`Ed25519`) HTTP webhook.
3. **Zero-Config Local Tunneling & Network Repair:** NearHook eliminates third-party reverse proxies (such as ngrok) and heavy message brokers by streaming verified events directly to cloud endpoints (`POST`) or NAT-isolated local development environments (`npx nearhook listen`). A three-tier self-healing pipeline pairs jittered exponential backoff with a tunnel ring-buffer and 1-click durable PostgreSQL `JSONB` historical replay.

---

## 1. The Landscape & Motivation: Why NEAR Needs a Native Webhook Layer

### 1.1 Event Ingestion Across Web3 Ecosystems

In mature blockchain ecosystems, developers and AI engineers rarely operate raw archival nodes or write continuous RPC polling loops merely to detect when a balance updates or a contract executes. Instead, ecosystems rely on specialized **Event-Push Gateways**:

* **Solana:** Platforms like Helius process raw validator slot data and program logs, transforming opaque instruction buffers into structured JSON payloads delivered via signed HTTP POST webhooks.
* **Ethereum & EVM L2s:** Providers like Alchemy Notify and Tenderly monitor block inclusion and finalized logs, firing HTTP requests whenever specific `LOG` opcodes (`topic0..topic3`) match user filter criteria.

These platforms enable cloud backends to operate in a scale-to-zero model, consuming zero idle compute while waiting for on-chain triggers.

### 1.2 The NEAR Paradox: AI-Native Execution Without Ingress Primitives

NEAR Protocol is engineered with architectural primitives uniquely suited for autonomous software agents and chain abstraction:

1. **Scoped Sandboxing via Function Call Access Keys:** Unlike Ethereum or Solana—where granting a private key to an external microservice or AI agent yields root-level authority to drain the entire wallet—NEAR cleanly decouples `FullAccess` keys from `FunctionCall` keys. A developer can provision an agent with a key restricted strictly to invoking a single method (e.g., `execute_intents`) on a specific contract (e.g., `intents.near`) with an immutable allowance and gas ceiling.
2. **Hierarchical Named Accounts:** Parent contracts and accounts can programmatically spawn sub-accounts (`agent-01.vault.near`, `user-42.shop.near`) without requiring human seed-phrase ceremonies.
3. **Chain Signatures (`v1.signer`) & Intents (`intents.near`):** A single NEAR account or smart contract can deterministically derive foreign addresses and sign transactions across Bitcoin, Solana, EVM networks, and non-EVM L1s via decentralized threshold ECDSA (`secp256k1`) and EdDSA (`ed25519`).

#### The Ingress Contradiction

An autonomous agent operates on a continuous cybernetic control loop:

$$\text{Listen (Ingest)} \longrightarrow \text{Reason (Inference / Policy)} \longrightarrow \text{Act (Sign \& Broadcast)}$$

While NEAR has perfected the **Act** phase, the **Listen** phase remains constrained by unergonomic patterns:

* **NEAR Lake Framework:** Requires provisioning AWS credentials, running persistent Rust/Python S3 consumer workers, and parsing raw `StreamerMessage` payloads containing every block, chunk, and receipt across the entire network.
* **Naive RPC Polling:** Forces developers or autonomous agents to execute continuous `while(true)` polling loops querying `EXPERIMENTAL_tx_status` or `block`. This burns RPC credits, keeps serverless functions awake 24/7, and introduces multi-second latency jitter.
* **Generic Multi-Chain Indexers:** Standard multi-chain webhook providers assume single-block atomic execution and flat hex addresses (`0x...`), making them incapable of understanding NEAR’s cross-shard receipt trees, wildcard sub-account namespaces (`*.app.near`), or DIP-4 (`NEP-297`) multi-token logs.

NearHook closes this loop. By transforming NEAR's asynchronous receipt stream into verified push notifications, cloud microservices and autonomous agents can sleep at **$0 idle compute cost** and wake up within milliseconds of a finalized on-chain state transition.

---

## 2. Formalizing Cross-Shard Receipt Stitching

### 2.1 The Execution Model: Nightshade Asynchronous Sharding

In monolithic blockchains (e.g., Ethereum, Solana), a transaction $T$ submitted to the network executes atomically within a single block height $B_t$. Every internal contract call within $T$ shares an execution frame; if an inner invocation reverts, the entire transaction reverts at block $B_t$.

NEAR Protocol employs **Nightshade Sharding**, partitioning state across multiple shards $S_0, S_1, \dots, S_k$. Because accounts and contracts reside on disparate shards, NEAR decouples transaction inclusion from execution using asynchronous message packets known as **Receipts**:

```text
User / Agent submits Transaction T: "Withdraw 100 USDC via intents.near to merchant.near"
 │
 ├──> Block B_101 (Shard 1): Receipt R_0 executes on `intents.near`
 │      • Deducts internal balance & emits optimistic log
 │      • Spawns Cross-Contract Promise: Receipt R_1 ──> `usdc.near`
 │      • Status of R_0: ✅ SuccessReceiptId(R_1)
 │
 ├──> Block B_102 (Shard 3): Receipt R_1 executes on `usdc.near` (`ft_transfer_call`)
 │      • Spawns Cross-Contract Promise: Receipt R_2 ──> `merchant.near` (`ft_on_transfer`)
 │      • Status of R_1: ✅ SuccessReceiptId(R_2)
 │
 ├──> Block B_103 (Shard 2): Receipt R_2 executes on `merchant.near`
 │      • Merchant contract panics ("Order expired / Out of stock!")
 │      • Status of R_2: ❌ Failure(ActionError::FunctionCallError)
 │
 └──> Block B_104 (Shard 1 & 3): Callback / Refund Receipt R_3 (`ft_resolve_transfer`)
        • Refunds 100 USDC back to original sender
        • Status of R_3: ✅ Refunded
```

### 2.2 The Optimistic Settlement Vulnerability

As explicitly recognized in the official NEAR Intents Verifier specification:

> *"For withdrawal events, it is often difficult to emit only on success because the outcome depends on cross-contract calls."*

If a naive webhook engine or RPC listener inspects Block $B_{101}$, it observes `Receipt R_0: Success` and immediately dispatches a webhook: `"Payment Confirmed!"`. Two blocks later ($B_{103}$), the inner cross-contract promise panics, and the protocol generates a refund receipt ($B_{104}$). Downstream systems relying on early callbacks have acted on partial, unfinalized state, leading to irrecoverable off-chain losses.

### 2.3 Mathematical Formulation of Receipt Stitching

NearHook models every transaction $T$ as a dynamic Directed Acyclic Graph (DAG):

$$G_T = (V_T, E_T)$$

where:
* Each vertex $v_i \in V_T$ represents a unique `ReceiptId` associated with root transaction hash $H(T)$, annotated with its observed `ExecutionOutcomeNode`.
* Each directed edge $(v_i, v_j) \in E_T$ represents a parent receipt $v_i$ spawning child receipt $v_j$ via `ExecutionOutcome.receipt_ids`.

As blocks stream into NearHook, define:
* $S_{\text{spawned}}(T) = \bigcup_{v \in V_T} \text{children}(v)$ as the cumulative set of all child receipt IDs generated by transaction $T$.
* $S_{\text{executed}}(T)$ as the cumulative set of all receipt IDs for which an `ExecutionOutcomeWithId` has been observed across any shard chunk.

#### The Stitching Completeness Invariant
NearHook buffers partial outcomes for $T$ in ephemeral hot memory (Redis) and **strictly forbids** dispatching a webhook until the set difference between spawned receipts and executed receipts is empty:

$$\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$$

Once $\Delta(T) = \emptyset$, the receipt tree is completely resolved. NearHook then evaluates the **True Terminal Status**:

$$\text{TerminalStatus}(T) = \begin{cases} 
\texttt{FAILED\_OR\_REFUNDED} & \text{if } \exists v \in V_T : \text{status}(v) = \texttt{Failure} \lor \text{is\_refund}(v) \lor \text{is\_action\_error}(v) \\ 
\texttt{SUCCESS} & \text{otherwise} 
\end{cases}$$

Refund receipts are deterministically detected via:
1. `predecessor_id == "system"`
2. Execution of protocol resolution callbacks (e.g., `ft_resolve_transfer`, `mt_resolve_transfer`).
3. Execution outcome status containing `ActionError::FunctionCallError`.

---

## 3. Omnichain Event Consolidation Architecture

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                    EXTERNAL BLOCKCHAINS (35+ NETWORKS)                      │
 │  • Bitcoin & UTXO (BTC, DOGE, LTC, BCH, ZEC)                                │
 │  • EVM L1/L2 (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB, Avalanche)  │
 │  • Non-EVM L1s (Solana, TON, XRP, Cosmos, Sui, Aptos, Cardano, Stellar)     │
 └───────────────────┬─────────────────────────────────────┬───────────────────┘
                     │                                     │
        (1. Cross-Chain Asset Swaps             (2. Outbound Foreign Tx Signing
            & Omnichain Balances)                   via Threshold Cryptography)
                     ▼                                     ▼
 ┌───────────────────────────────────────┐ ┌───────────────────────────────────┐
 │      NEAR INTENTS (`intents.near`)    │ │    CHAIN SIGNATURES (`v1.signer`) │
 │  • Emits NEP-297 / DIP-4 JSON logs:   │ │  • Emits Threshold MPC Signatures │
 │    - `token_diff` (Atomic Swaps)      │ │    - Secp256k1 (EVM, BTC, DOGE)   │
 │    - `ft_withdraw` / `mt_transfer`    │ │    - Ed25519 (Solana, TON, Sui)   │
 │    - `intents_executed`               │ │  • Deterministic `derivation_path`│
 └───────────────────┬───────────────────┘ └───────────────┬───────────────────┘
                     │                                     │
                     └──────────────────┬──────────────────┘
                                        │ (Included in NEAR Shards)
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                      NEARHOOK ENGINE (INGEST & STITCH)                      │
 │  1. Streams blocks via FastNEAR NEARDATA (`/v0/block_opt/{height}`)         │
 │  2. Stitches multi-shard receipts in Redis (`SDIFF spawned executed == 0`)  │
 │  3. Decodes DIP-4 `nep141:*.omft.near` omni-tokens & MPC derivation paths   │
 │  4. Attaches `X-NearHook-Signature: ed25519:<sig>` & saves JSONB to NeonDB  │
 └───────────────────┬─────────────────────────────────────┬───────────────────┘
                     │                                     │
         (Mode A: Production Cloud)             (Mode B: Local Dev / Agent)
                     ▼                                     ▼
 ┌───────────────────────────────────────┐ ┌───────────────────────────────────┐
 │       HTTPS POST WEBHOOK              │ │       NEARHOOK CLI TUNNEL         │
 │  • Next.js / FastAPI / Serverless     │ │  `npx nearhook listen --port 3k`  │
 │  • Wakes sleeping AI agents ($0 idle) │ │  • Streams over WebSocket -> HTTP │
 └───────────────────────────────────────┘ └───────────────────────────────────┘
```

### 3.1 Consolidating 35+ Chains on NEAR Clearinghouses

Orchestrating cross-chain applications or multi-chain AI solvers traditionally requires integrating disjoint indexing stacks:
* **Solana:** Helius / Triton Geyser gRPC plugins.
* **EVM Ecosystem:** Alchemy / QuickNode JSON-RPC polling across 10+ distinct L2 RPCs.
* **UTXO Chains:** Custom Bitcoin Core / Electrum indexers.
* **Cosmos / Non-EVM:** IBC relayer log parsers.

NearHook leverages the fact that multi-chain liquidity and cross-chain execution increasingly converge on NEAR as a decentralized clearinghouse:
1. **NEAR Intents (`intents.near`):** Handles multi-chain deposits, atomic swaps, and cross-chain settlement across 35+ chains via Omni-Bridge (`*.omft.near`) assets.
2. **Chain Signatures (`v1.signer`):** Uses threshold MPC nodes to construct valid foreign-chain signatures (Bitcoin, Ethereum, Solana, Cosmos) controlled directly by NEAR smart contracts.

By indexing these clearinghouses, a single NearHook webhook replaces the operational overhead of running 35+ separate chain indexers.

### 3.2 DIP-4 / NEP-297 Event Parser

`intents.near` logs state transitions adhering to the `NEP-297` standard with the `dip4` schema:

```json
EVENT_JSON:{
  "standard": "dip4",
  "version": "0.3.0",
  "event": "token_diff",
  "data": [
    {
      "account_id": "solver-alpha.near",
      "intent_hash": "5GpL6PsUQVHFYAk5FWEwBUaEQqcZkc2SjTvPYHgHAnx8",
      "diff": {
        "nep141:sol.omft.near": "-15000000000",
        "nep141:btc.omft.near": "2850000"
      }
    }
  ]
}
```

NearHook decodes raw Omni-Bridge addresses into normalized chain representations:
* `nep141:sol.omft.near` $\longrightarrow$ `source_chain: "SOLANA"` (15.0 SOL)
* `nep141:btc.omft.near` $\longrightarrow$ `destination_chain: "BITCOIN"` (0.0285 BTC)
* `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` $\longrightarrow$ `chain: "BASE"` (USDC)

### 3.3 MPC Chain Signatures Parser (`v1.signer`)

When a contract on NEAR requests an external signature, it invokes `sign` on `v1.signer` with a `payload` (hash), `path` (e.g., `"bitcoin-1"`), and `key_version`. The decentralized MPC network computes the signature over several blocks and emits the threshold `big_r` and `s` components in an asynchronous callback receipt.

NearHook stitches the initial request receipt with the terminal MPC callback receipt, delivering the completed foreign transaction signature in a single payload.

---

## 4. Cryptographic Security & Asymmetric Attestation

Because webhooks trigger mission-critical off-chain actions—such as releasing physical goods, updating financial ledgers, or executing autonomous trades—receivers must authenticate that incoming payloads originate from NearHook and have not been spoofed or tampered with in transit.

### 4.1 The Weakness of Symmetric HMAC Secrets

Traditional webhook systems rely on symmetric HMAC-SHA256 secrets. In multi-agent or microservice architectures, symmetric secrets exhibit distinct vulnerabilities:
1. **Key Compromise:** If an agent runtime or client database leaks the shared secret, an attacker can forge arbitrary webhook requests indistinguishable from authentic events.
2. **Key Coordination Overhead:** Each consumer must provision, rotate, and securely store unique secrets.

### 4.2 Ed25519 Asymmetric Relayer Signing

NearHook implements **Asymmetric Ed25519 Attestation**, aligning natively with NEAR Protocol's primary cryptographic curve:

1. **Canonical Signing Pre-Image Construction:**  
   Given the Unix epoch timestamp in seconds ($\tau$) and the raw UTF-8 serialized JSON payload ($B$), NearHook constructs the canonical message pre-image:

$$M = \tau \parallel \text{"."} \parallel B$$

2. **Signature Generation:**  
   Using the NearHook Relayer’s private signing key $sk_{\text{relayer}}$, it computes the 64-byte Ed25519 signature:

$$\sigma = \text{Ed25519\_Sign}_{sk_{\text{relayer}}}(M)$$

3. **HTTP Header Injection:**
   * `X-NearHook-Id: evt_8f902ba1c4`
   * `X-NearHook-Timestamp: 1762849200`
   * `X-NearHook-Signature: ed25519:<hex_encoded_sigma>`
   * `X-NearHook-PubKey: ed25519:<base58_relayer_public_key>`

### 4.3 Stateless Verification Algorithm

Receiving endpoints verify webhooks statelessly in $<0.2\text{ms}$ with zero external RPC dependencies:

```typescript
import { ed25519 } from '@noble/curves/ed25519';

export function verifyNearHookWebhook(
  headers: Record<string, string>,
  rawBody: string,
  relayerPublicKeyHex: string
): boolean {
  const timestamp = parseInt(headers['x-nearhook-timestamp'], 10);
  const signatureHex = headers['x-nearhook-signature'].replace(/^ed25519:/, '');
  
  // 1. Replay attack rejection (5-minute tolerance window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }
  
  // 2. Reconstruct pre-image M = tau . B
  const message = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  
  // 3. Cryptographic signature check
  return ed25519.verify(signatureHex, message, relayerPublicKeyHex);
}
```

---

## 5. Storage Topology: Ephemeral Hot Memory & Durable Persistence

Rather than forcing consumers to run heavy polling loops or indexing entire historical blockchain ledgers, NearHook bifurcates state management across two purpose-built storage layers modeled after modern high-throughput webhook architectures:

### 5.1 Ephemeral Hot Memory (Redis — 60-Second TTL)

Cross-shard execution receipts resolve across shards in 2 to 4 consecutive blocks (~2–5 seconds). Buffering these transient receipt outcomes requires ultra-low latency atomic set and hash operations:

1. **In-Flight Receipt Tracking:**
   * `nearhook:tx:{hash}:spawned`: An atomic Redis Set storing all `ReceiptId`s spawned by the transaction.
   * `nearhook:tx:{hash}:executed`: An atomic Redis Set storing all `ReceiptId`s for which an `ExecutionOutcomeWithId` has been observed.
   * `nearhook:tx:{hash}:nodes`: A Redis Hash mapping `ReceiptId` to its serialized execution outcome node.
   * `nearhook:tx:{hash}:edges`: A Redis List tracking directed parent-to-child promise delegations.

2. **Atomic Invariant Resolution:**
   NearHook evaluates the completeness invariant using atomic set differences:
   ```text
   SDIFF nearhook:tx:{hash}:spawned nearhook:tx:{hash}:executed
   ```
   This operation executes in hot memory in $<2\text{ms}$. When the set difference evaluates to empty ($\Delta(T) = \emptyset$), the receipt tree is assembled, processed, and handed off to the delivery pipeline.

3. **Automatic Cleanup & Bounded Footprint:**
   Every key written to Redis is tagged with a 60-second Time-To-Live (TTL). Upon successful terminal resolution, keys are immediately purged. This ensures that even under high transaction volumes, NearHook’s hot memory consumption remains bounded at $<50\text{MB}$.

### 5.2 Durable Relational Store (PostgreSQL / NeonDB)

Once a receipt DAG is stitched and matched against active subscriptions, the resulting payload transitions from hot memory to durable persistence:

1. **`subscriptions` Table:**
   * Stores user-defined wildcard account patterns (`*.app.near`, `intents.near`), omnichain filters (`SOLANA`, `BITCOIN`), endpoint target URLs, and circuit breaker health statuses.
   * Queried dynamically with indexed in-memory caching to route incoming events in $<1\text{ms}$.

2. **`deliveries` Table (`JSONB` Storage):**
   * Persists the exact, final canonical payload in a PostgreSQL `JSONB` column, alongside HTTP response status codes (`200 OK`, `502 Bad Gateway`), round-trip latencies, and attempt counters.
   * Powers the 1-click historical replay engine: developers can re-dispatch any previous on-chain event to local or cloud endpoints without needing to re-sign transactions or pay on-chain gas.

---

## 6. Self-Healing Delivery & Network Repair

### 6.1 Three-Tier Delivery Pipeline

When external endpoints experience transient downtime or local connections disconnect, NearHook automatically initiates network repair:

* **Tier 1: Exponential Backoff Retry Queue (Redis):**  
  Deliveries returning status $\ge 400$ or timing out ($>5000\text{ms}$) are re-enqueued with jittered exponential backoff intervals ($1\text{s} \to 3\text{s} \to 9\text{s} \to 27\text{s} \to 81\text{s}$).
* **Tier 2: Tunnel Ring-Buffer Flush:**  
  For connected developer tunnels (`nearhook listen`), NearHook maintains a per-session circular buffer in memory. If a local connection drops for a brief period (e.g. Wi-Fi reconnection or local server restart), missed events flush sequentially upon handshake completion.
* **Tier 3: 1-Click Durable JSONB Replay:**  
  Because every stitched payload is preserved in PostgreSQL `JSONB`, developers can re-dispatch past events via the dashboard or CLI (`nearhook replay <event_id>`), re-running handlers in $<10\text{ms}$ without modifying on-chain state.

### 6.2 Circuit Breaker Protection

To protect outbound relayers from DDoS-ing dead destination servers, NearHook implements an automated circuit breaker:

$$\text{CircuitState} = \begin{cases} 
\texttt{PAUSED\_UNHEALTHY} & \text{if } \text{consecutive\_failures} \ge 10 \lor \text{failure\_rate}_{50} > 95\% \\ 
\texttt{ACTIVE} & \text{otherwise} 
\end{cases}$$

Endpoints entering `PAUSED_UNHEALTHY` receive no further outbound requests until manually or programmatically reset.

---

## 7. Consumption Modes

### Mode A: Production Cloud Webhooks (HTTPS POST)
Engineered for Next.js servers, FastAPI microservices, Telegram bots, and serverless runtimes (Vercel, AWS Lambda, Cloudflare Workers). Developers register a wildcard filter (`*.near`, `intents.near`) and a target HTTPS URL.

### Mode B: Zero-Config Local CLI Tunnel (`npx nearhook listen`)
Engineered for local development environments behind NAT or firewalls:

```bash
npx nearhook listen --account "*.myapp.testnet" --chains SOLANA,BITCOIN --forward http://localhost:3000/api/webhook
```

1. Establishes an outbound persistent WebSocket connection to the NearHook Tunnel Hub.
2. Verifies the relayer’s `Ed25519` signature locally inside the CLI process.
3. Forwards the verified payload via HTTP POST to `localhost:3000`.
4. Streams the local response code and latency back to the developer console.

### Mode C: Autonomous AI Agent Ingress (Scale-to-Zero)
Engineered for autonomous agent frameworks (ElizaOS, LangChain, MCP). Agents expose a lightweight `/wakeup` HTTP route and sleep at $0 idle cost. When a relevant cross-chain intent or MPC signature settles on NEAR, NearHook pushes the stitched payload, waking the agent to execute its reasoning and transaction-signing cycle.

---

## 8. Canonical Webhook Payload Specification

Below is the formal JSON schema delivered by NearHook upon completing the stitch of a 3-shard cross-chain `SOL -> BTC` settlement:

```json
{
  "event_id": "evt_99214a8b3c",
  "event_type": "CROSS_CHAIN_INTENT_SETTLED",
  "network": "mainnet",
  "matched_subscription": {
    "subscription_id": "sub_44192a",
    "account_filter": "intents.near",
    "chain_filter": ["SOLANA", "BITCOIN"]
  },
  "settlement": {
    "origin_tx_hash": "8kL9v7m2xPqR4tY9uW1zK3nM5pQ7vB2cX4zL9mN1pQr",
    "root_receipt_id": "4fG1b89aBcDeF2gH3iJ4kL5mN6oP7qR8sT9uV0wXyZ1",
    "start_block_height": 142890120,
    "final_block_height": 142890122,
    "blocks_spanned": 3,
    "cross_shard_hops": 3,
    "terminal_status": "SUCCESS",
    "total_gas_burnt_tgas": 14.8
  },
  "receipt_tree_dag": {
    "nodes": [
      {
        "receipt_id": "4fG1b89aBcDeF2gH3iJ4kL5mN6oP7qR8sT9uV0wXyZ1",
        "block_height": 142890120,
        "shard_id": 1,
        "receiver_id": "intents.near",
        "method": "execute_intents",
        "status": "SuccessReceiptId"
      },
      {
        "receipt_id": "9aBc2d3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4LmN4",
        "block_height": 142890121,
        "shard_id": 3,
        "receiver_id": "btc.omft.near",
        "method": "ft_withdraw",
        "status": "SuccessReceiptId"
      },
      {
        "receipt_id": "7xKp93m2L1aB4c5d6e7f8g9h0i1j2k3l4m5n6o7pQrS8",
        "block_height": 142890122,
        "shard_id": 0,
        "receiver_id": "v1.signer",
        "method": "sign",
        "status": "SuccessValue"
      }
    ],
    "edges": [
      { 
        "from": "4fG1b89aBcDeF2gH3iJ4kL5mN6oP7qR8sT9uV0wXyZ1", 
        "to": "9aBc2d3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4LmN4" 
      },
      { 
        "from": "9aBc2d3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4LmN4", 
        "to": "7xKp93m2L1aB4c5d6e7f8g9h0i1j2k3l4m5n6o7pQrS8" 
      }
    ]
  },
  "omnichain_route": {
    "protocol": "NEAR_INTENTS_DIP4",
    "standard_version": "0.3.0",
    "source_chain": "SOLANA",
    "source_token_id": "nep141:sol.omft.near",
    "source_amount_formatted": "15.0 SOL",
    "destination_chain": "BITCOIN",
    "destination_token_id": "nep141:btc.omft.near",
    "destination_amount_formatted": "0.0285 BTC",
    "destination_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    "solver_account_id": "wintermute.solver.near"
  },
  "chain_signature": {
    "mpc_contract": "v1.signer",
    "derivation_path": "bitcoin-1",
    "scheme": "secp256k1",
    "signature_ready": true
  },
  "attestation": {
    "relayer_id": "relayer.nearhook.near",
    "timestamp": 1762849200,
    "signature": "ed25519:3N8xZ2LkdIwHu7ix9pLmQ4vB7nM2kP8xR1tY5uW9zQ24mNpL8sV7..."
  }
}
```

---

## 9. Performance & Latency Benchmarks

NearHook streams blocks via FastNEAR’s low-latency `NEARDATA` HTTP interface (`/v0/last_block/optimistic` and `/v0/block_opt/{height}`).

Table 2 details the execution latency added by NearHook on top of block inclusion:

| Pipeline Stage | Technology | Latency |
| :--- | :--- | :--- |
| **FastNEAR Block Ingestion** | HTTP Chunk Streaming | $15\text{ms} - 30\text{ms}$ |
| **Receipt Extraction & Redis Set Diff** | Atomic `SDIFF` / `SADD` | $<2\text{ms}$ |
| **Omnichain Normalization (DIP-4 / MPC)** | Pure In-Memory Parser | $<0.5\text{ms}$ |
| **Ed25519 Cryptographic Signing** | `@noble/curves/ed25519` | $<0.2\text{ms}$ |
| **Neon PostgreSQL JSONB Write** | Asynchronous Persistence | $10\text{ms} - 25\text{ms}$ |
| **HTTP Dispatch / WebSocket Push** | Outbound Socket Stream | $5\text{ms} - 15\text{ms}$ |
| **Total Added Pipeline Overhead** | **NearHook End-to-End** | **$<50\text{ms}$** |

---

## 10. Frequently Asked Questions

### Q1: Why not implement event dispatching inside a NEAR smart contract?
Smart contracts execute within a deterministic WebAssembly (Wasm) sandbox on validator nodes. Wasm contracts are prohibited from opening outbound TCP sockets, issuing HTTP POST requests, or establishing persistent WebSocket tunnels. NearHook operates as high-performance off-chain infrastructure to bridge on-chain state to the web.

### Q2: How are hierarchical sub-accounts supported?
Unlike flat hex addresses (`0x...`), NEAR architectures use hierarchical namespaces (`agent-1.myapp.near`, `order-99.shop.near`). NearHook implements glob and wildcard pattern matching (`*.shop.near`) directly in its subscription engine, allowing a single subscription rule to capture events across an entire dynamic sub-account fleet.

### Q3: What happens when an out-of-order receipt arrives?
Because receipt outcomes from different shards stream concurrently, child receipts may occasionally arrive at the indexer before their parent receipt has been recorded. NearHook stores receipt outcomes in Redis hashes independently of arrival order. Completeness is governed solely by the set difference $\Delta(T) = S_{\text{spawned}}(T) \setminus S_{\text{executed}}(T) = \emptyset$, which evaluates to false until every linked receipt in the tree has executed.

---

## 11. Conclusion

By combining **Stateful Cross-Shard Receipt Stitching**, **Omnichain Event Consolidation (`intents.near` + `v1.signer`)**, **Ed25519 Cryptographic Attestation**, and **Zero-Config Local Tunneling (`npx nearhook listen`)**, NearHook provides the missing event-ingestion infrastructure for NEAR Protocol. It shields developers from the complexities of Nightshade sharding, solves Optimistic Settlement Vulnerabilities, and enables cloud backends and autonomous AI agents to interact with 35+ blockchains through a single, unified, cryptographically verified HTTPS pipe.

---

## References

1. Skidanov, A., & Polosukhin, I. (2019). *Nightshade: Consensus and sharding specification for NEAR Protocol*. NEAR Research.
2. NEAR Protocol Specification. *Receipts and Cross-Contract Calls Architecture*. https://nomicon.io/Architecture#receipts
3. NEAR Enhancement Proposals. *NEP-297: Event Standard Specification*. https://github.com/near/NEPs/blob/master/neps/nep-0297.md
4. Decentralized Intent Protocol. *DIP-4: Multi-Token Intent Event Standards for intents.near*.
5. NEAR Intents Documentation. *NEAR Intents Verifier Contract Specification & Settlement Proofs*.
6. NEAR Core Team. *Multi-Party Computation (MPC) Chain Signatures Specification (`v1.signer`)*.
7. FastNEAR. *NEARDATA Real-Time Sharded Block Streaming Endpoints*. https://neardata.xyz

