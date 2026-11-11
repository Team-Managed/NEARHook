# NearHook: Asynchronous Receipt Stitching & Cross-Chain Event Ingress for NEAR Protocol

**Whitepaper** • Version 2.6 • November 2026  

---

## 1. What is NearHook?

> **NearHook stitches NEAR’s asynchronous receipts into signed webhooks across 35+ chains (Bitcoin, Ethereum, Solana, and beyond). It streams verified cross-chain events straight to cloud backends or local AI agents via a zero-config CLI tunnel.**

To understand why this is a major breakthrough, consider its three pillars:

```mermaid
flowchart TD
    subgraph P1["1. Receipt Stitching"]
        direction TB
        S1["Fragmented Shard Receipts<br/>(Resolving across 2–4 blocks)"] --> ST["NearHook Stitcher<br/>Correlates & waits for refunds"]
        ST --> ST2["1 Complete, Verified Event"]
    end

    subgraph P2["2. 35+ Chains in One Stream"]
        direction TB
        C1["Bitcoin • Ethereum • Solana • Base"] --> CL["NEAR Clearinghouses<br/>(intents.near & v1.signer)"]
        CL --> C2["Unified Cross-Chain Payload"]
    end

    subgraph P3["3. Direct Ingress & Tunneling"]
        direction TB
        T1["Verified Ed25519 Payload"] --> CLD["Cloud Backends (HTTPS POST)"]
        T1 --> LOC["Local AI Agents & Devs<br/>(npx nearhook listen)"]
    end

    P1 ==> P2 ==> P3

    style P1 fill:#111827,stroke:#00EC97,stroke-width:1px,color:#fff
    style P2 fill:#111827,stroke:#9945FF,stroke-width:1px,color:#fff
    style P3 fill:#111827,stroke:#3B82F6,stroke-width:1px,color:#fff
```

### Pillar 1: What is "Receipt Stitching"?
On NEAR, a single transaction doesn't execute in one atomic step. It fragments into multiple asynchronous pieces called **Receipts** that jump across shards over 2 to 4+ blocks. 

**"Stitching"** means NearHook acts as the puzzle assembler: it tracks the parent receipt, follows every child promise, monitors refund callbacks, and holds the event in memory until the whole tree completes. It stitches the fragmented pieces into a single, cohesive, finalized event.

### Pillar 2: How Does it Cover 35+ Chains?
NEAR is an omnichain clearinghouse:
* **NEAR Intents (`intents.near`):** Swaps and bridges tokens across 35+ networks (Bitcoin, Solana, Ethereum, Dogecoin, Base, Arbitrum) using native Omni-Bridge contracts.
* **Chain Signatures (`v1.signer`):** Uses decentralized Multi-Party Computation (MPC) to sign transactions for foreign blockchains directly from NEAR.

Instead of paying for and maintaining 35 separate blockchain indexers, NearHook indexes NEAR's clearinghouse contracts, turning multi-chain settlements into **one unified webhook pipe**.

### Pillar 3: Streaming to Cloud Backends & Local AI Agents
* **Production Cloud:** Dispatches signed HTTPS POST webhooks to your serverless functions or microservices (Next.js, FastAPI, AWS Lambda).
* **Local Development & AI Agents:** Running `npx nearhook listen` streams live verified events straight into your local server (`localhost:3000`) or local AI agent runtime (ElizaOS, LangChain) with zero setup and no ngrok.
* **Scale-to-Zero:** AI agents sleep at **$0 idle compute cost** and wake up in milliseconds only when a verified event arrives.

---

## 2. The Problem: The "Early Webhook" Trap

On single-block blockchains (Ethereum, Solana), transactions finish immediately. 

On NEAR's Nightshade sharded architecture, transactions take **2 to 4 blocks** to complete. If an indexer fires a webhook on Block 1, your backend acts on partial state before downstream calls have finished:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / AI Agent
    participant Shard1 as Shard 1 (intents.near)
    participant Shard3 as Shard 3 (usdc.near)
    participant Shard2 as Shard 2 (merchant.near)
    participant Backend as Your Backend

    User->>Shard1: 1. Start cross-chain transfer
    Shard1->>Shard1: Deducts tokens (Initial Success)
    Note right of Shard1: Naive indexers send webhook HERE! ⚠️
    Shard1-->>Backend: ❌ "Payment Received!" (PREMATURE)
    Shard1->>Shard3: Spawn Promise Receipt R_1 (ft_transfer_call)

    Note over Shard3: Block B_102
    Shard3->>Shard2: Spawn Promise Receipt R_2 (ft_on_transfer)
    Shard3->>Shard3: Register Callback Receipt R_3 (ft_resolve_transfer)

    Note over Shard2: Block B_103
    Shard2--xShard2: PANIC: Out of stock / Order expired!
    Shard2-->>Shard3: Return Failure

    Note over Shard3: Block B_104
    Shard3->>Shard3: Execute Callback R_3: Refund 100 USDC to sender
    Note over Shard3: Transfer Refunded! User got money back.
```

**The consequence:** If you fulfilled an order on Block 1, you gave away goods for free because the payment was refunded on Block 4.

---

## 3. Why Can't You Just Use NEAR Lake or FastNEAR Directly?

A common question is: *"If NEAR Lake and FastNEAR already exist, why can't developers just consume them directly?"*

Here is why:

### 1. Smart Contracts Cannot Send Webhooks
Smart contracts execute inside a WebAssembly (Wasm) sandbox on validator nodes. They are strictly prohibited from opening outbound TCP sockets, making HTTP POST requests, or calling external APIs. The blockchain cannot push events to you—an off-chain bridge must ingest and deliver them.

### 2. Why Not NEAR Lake?
* **High Latency:** NEAR Lake writes block files to **AWS S3 buckets**. Polling S3 introduces a **1.5 to 3+ second delay** after block inclusion.
* **Heavyweight & Expensive:** Consuming NEAR Lake requires AWS credentials, S3 SDKs, and running a persistent Rust/Python container parsing every block on the network. This costs **$50–$200+/month** in cloud compute—unviable for developers who just need a simple webhook for their own contract.
* **No Optimistic Blocks:** NEAR Lake only archives finalized blocks.

### 3. Why Not FastNEAR Directly?
FastNEAR provides an ultra-low latency HTTP API (`/v0/block_opt/{height}`). NearHook uses FastNEAR internally for this reason. But consuming FastNEAR directly as an application developer presents major hurdles:

* **Raw Network Dump (Not a Webhook):** FastNEAR is a pull-based query API, not an event-push service. Querying a block returns a **massive 2MB–5MB JSON dump of every transaction, receipt, and execution across all shards on the entire network**. You would have to write custom code to filter out 99.9% of irrelevant data.
* **FastNEAR Does NOT Stitch Receipts:** FastNEAR gives you a raw snapshot of what happened in Block 101. It will **not** correlate that Block 101's receipt spawns a promise in Block 102, panics in Block 103, and refunds in Block 104. If you use FastNEAR directly, **you must build your own distributed receipt tracker and state machine in Redis/PostgreSQL**.
* **Pull vs. Push (Scale-to-Zero):** Serverless backends (Vercel, AWS Lambda) and autonomous AI agents need to sleep at **$0 idle cost** and wake up for 50ms when an HTTP `POST` arrives. They cannot run a continuous 24/7 `while(true)` polling loop against FastNEAR without burning continuous compute bills.
* **Cannot Reach `localhost:3000`:** FastNEAR cannot stream events into your laptop behind Wi-Fi routers and NAT firewalls. Testing locally requires paying for and configuring ngrok or cloud proxies.

```mermaid
flowchart LR
    NEAR["NEAR Network<br/>(Shards 0, 1, 2, 3)"] ==> FastNEAR["FastNEAR API<br/>(Raw Block Firehose)"]
    FastNEAR ==> NearHook["NEARHOOK ENGINE<br/>• Filters your contracts<br/>• Stitches receipt graph<br/>• Verifies refunds & signs"]
    NearHook ==> Dev["DEVELOPER / AI AGENT<br/>• Clean HTTP POST Webhook<br/>• Instant `npx nearhook listen`<br/>• $0 idle compute cost"]

    style NEAR fill:#111827,stroke:#00EC97,stroke-width:1px,color:#fff
    style FastNEAR fill:#111827,stroke:#F59E0B,stroke-width:1px,color:#fff
    style NearHook fill:#0B0F17,stroke:#9945FF,stroke-width:2px,color:#fff
    style Dev fill:#064E3B,stroke:#00EC97,stroke-width:2px,color:#fff
```

> **The Analogy:** FastNEAR is the **firehose of raw municipal water** (high-speed raw data for the entire network). NearHook is the **smart filtration system and kitchen tap**: it filters the noise, tracks the exact transaction you care about, ensures it wasn't refunded, signs it, and pours it straight into your server or local laptop.

---

## 4. How NearHook Stitches Receipts & Detects Refunds

Here is the master architecture showing how fragmented shard receipts flow from the NEAR blockchain through the dynamic DAG stitcher and into your cloud backend, local server, or AI agent:

```mermaid
flowchart TD
    subgraph S1["1. NEAR Nightshade Shards (Raw Receipts)"]
        direction LR
        SH0["Shard 0: Signatures"] 
        SH1["Shard 1: Intents"] 
        SH2["Shard 2: Merchant"] 
        SH3["Shard 3: Tokens"]
    end

    subgraph S2["2. Ingestion & Early-Exit Sieve"]
        direction TB
        FN["FastNEAR Block Ingestion<br/>Reads execution outcomes with tx_hash"]
        FILTER{"Subscription Sieve<br/>Matches your contract?"}
        DROP["Discard 95%+ Noise<br/>(Spam, meme tokens, bots)"]
        FN --> FILTER
        FILTER -- "No Match" --> DROP
    end

    subgraph S3["3. Dynamic DAG Stitcher (The Engine)"]
        direction TB
        subgraph DAG["Dynamic Receipt Dependency Graph"]
            direction LR
            R0["R0: intents.near<br/>Initial Call"] -->|"Spawns"| R1["R1: usdc.near<br/>ft_transfer_call"]
            R1 -->|"Spawns"| R2["R2: merchant.near<br/>Panics / Fails"]
            R1 -.->|"Callback"| R3["R3: usdc.near::resolve<br/>Refunds Sender"]
            R2 ==>|"Error Input"| R3
        end
        PRUNE["Prune Gas Change Receipts<br/>(Drops system gas refunds → saves 1.1s)"]
        CHECK{"Completeness Check<br/>Spawned − Executed = 0?"}
        HOLD["Buffer in Hot Memory<br/>(Wait for remaining shards)"]
        
        DAG --> PRUNE --> CHECK
        CHECK -- "Pending" --> HOLD
    end

    subgraph S4["4. Settlement & Attestation"]
        direction TB
        SETTLE["Dual-Axis Settlement Evaluator<br/>• protocol_status: SUCCESS<br/>• business_status: REFUNDED"]
        NORM["Clearinghouse Normalizer<br/>Decodes DIP-4 token diffs & MPC signatures"]
        SIGN["Ed25519 Attestation Engine<br/>Signs canonical payload with relayer key"]
        SETTLE --> NORM --> SIGN
    end

    subgraph S5["5. Delivery Targets (Who Receives It)"]
        direction LR
        subgraph T1["Target A: Cloud Webhooks"]
            WH["HTTPS POST Webhook<br/>(Exponential retry + circuit breaker)"] --> CLD["Cloud Backends<br/>Next.js • FastAPI • AWS Lambda"]
        end
        subgraph T2["Target B: Local Developer CLI"]
            WS["WebSocket Tunnel Hub"] --> CLI["npx nearhook listen"] --> LOC["http://localhost:3000<br/>(Zero-config, no ngrok)"]
        end
        subgraph T3["Target C: Autonomous AI Agents"]
            AI["Wakeup Webhook"] --> AGT["Sleeping AI Agents<br/>ElizaOS • LangChain<br/>($0 idle compute cost)"]
        end
    end

    S1 ==>|"Block Chunks"| FN
    FILTER -- "Subscribed Match" --> DAG
    CHECK -- "Settled (Remaining = 0)" --> SETTLE
    SIGN ==>|"Attested Webhook Payload"| S5

    style S1 fill:#111827,stroke:#00EC97,stroke-width:1px,color:#fff
    style S2 fill:#111827,stroke:#F59E0B,stroke-width:1px,color:#fff
    style S3 fill:#0B0F17,stroke:#9945FF,stroke-width:2px,color:#fff
    style S4 fill:#111827,stroke:#3B82F6,stroke-width:1px,color:#fff
    style S5 fill:#0B0F17,stroke:#00EC97,stroke-width:2px,color:#fff
    style DAG fill:#1F2937,stroke:#A855F7,stroke-width:1px,color:#fff
    style T1 fill:#111827,stroke:#3B82F6,stroke-width:1px,color:#fff
    style T2 fill:#111827,stroke:#F59E0B,stroke-width:1px,color:#fff
    style T3 fill:#111827,stroke:#10B981,stroke-width:1px,color:#fff
    style DROP fill:#374151,stroke:#6B7280,stroke-width:1px,color:#9CA3AF
    style HOLD fill:#374151,stroke:#6B7280,stroke-width:1px,color:#9CA3AF
```

### 1. Assembling the Puzzle Dynamically (Zero Hardcoding)
On NEAR, you cannot predict what a transaction will do before it runs. A smart contract's internal code (`if/else`, market liquidity, price checks) decides on the spot whether to spawn 0, 2, or 5 follow-up calls across different shards.

**NearHook never hardcodes expected paths or contract names.** Instead, it dynamically follows the trail of receipts as they appear on the blockchain:
* **The Steps (Nodes):** Every receipt execution that lands on any shard tells NearHook: *"Here is what I just did, whether I succeeded or failed, and what new child receipts I spawned."*
* **The Connections (Edges):** If Receipt A spawns Receipts B and C, NearHook links them together as parent and children.
* **The Follow-ups (Callbacks):** If a contract sets up a safety refund callback (like `ft_resolve_transfer`), NearHook marks it to wait for the child call's result.
* **Chronological Assembly:** Once all follow-up steps have finished, NearHook reads the events in the exact order they happened, confirms whether money actually moved, and creates one simple, final story.

### 2. Who Collects From This Receipt Tree?
Developers and AI agents **never have to deal with the complex receipt tree directly**. The tree is strictly an internal assembly line inside NearHook.

The moment the tree completes, NearHook's **Dispatcher** packages the final story into a clean, human-readable JSON message and delivers it to:

1. **Your Cloud Backend (HTTPS POST):** Sent to your serverless functions or microservices (Next.js, FastAPI, Express, AWS Lambda).
2. **Your Local Laptop (`npx nearhook listen`):** Forwarded directly to `localhost:3000` while you develop and test locally, with zero setup and no ngrok.
3. **Autonomous AI Agents:** Delivered to AI agent frameworks (ElizaOS, LangChain), waking sleeping agents up only when a verified transaction arrives ($0 idle compute cost).

### 3. The Completeness Rule: When is a Transaction Truly Done?
Because receipt trees unfold dynamically, NearHook tracks two dynamic sets in memory:
* **Spawned Receipts ($S_{\text{spawned}}$):** Every child promise and callback dynamically registered by executed receipts.
* **Executed Receipts ($S_{\text{executed}}$):** Every receipt that has finished execution on its respective shard.
* **Terminal Settlement:** A transaction is only settled when **every spawned receipt has executed** (`Remaining = Spawned − Executed = ∅`) AND the root transaction has been recorded. Only then does NearHook package and sign the final webhook.

### 4. The 1-Block Latency Win: Pruning "Gas Change" Receipts
On NEAR, every smart contract call attaches extra gas (e.g. 30 TGas for a 4 TGas call). When the call finishes, the NEAR runtime automatically generates a child receipt from `"system"` to return the unspent gas back to the user's wallet.

* **The Problem with Naive Indexers:** Waiting for that trivial gas refund receipt adds **1 full block of artificial latency (~1.1 seconds)** to every single transaction.
* **NearHook's Optimization:** NearHook inspects child receipts in real time. If a child receipt is purely returning unspent gas from `"system"`, NearHook prunes it from the dependency tree immediately. Your webhook fires **1 full block faster (~1.1s latency shaved off)** without sacrificing any safety.

### 5. Understanding Business Outcomes: Gas Change vs. Real Refunds
NearHook makes a sharp distinction between two fundamentally different types of refunds:

| Attribute | System Gas Refund ("Gas Change") | Business Refund (`ft_resolve_transfer`) |
| :--- | :--- | :--- |
| **Origin** | NEAR protocol runtime (`system`) | The calling smart contract (e.g. `usdc.near`) |
| **Trigger** | Unspent gas from a function call | A downstream contract failed or panicked |
| **Smart Contract Logic** | None (pure balance transfer) | Yes (reverses token balances and logs refund) |
| **NearHook Action** | **Prunes immediately** (saves 1.1s) | **Tracks in tree** (marks event as `REFUNDED`) |

When a contract callback like `ft_resolve_transfer` handles a failure and returns tokens to the sender, NearHook marks the payload's `business_status` as `REFUNDED` instead of reporting a false success.

### 6. Early-Exit Sieve: Filtering 95%+ of Network Noise
NEAR processes hundreds of receipts per second across thousands of unrelated contracts (games, meme tokens, bot claims). 

NearHook uses a high-speed in-memory subscription sieve. Transactions that do not touch your subscribed contracts or registered cross-chain clearinghouses (`intents.near`, `v1.signer`) are discarded immediately. This keeps NearHook's memory footprint tiny and ensures sub-millisecond webhook routing.

### 7. Architectural Foundations: Built on Proven Systems
NearHook's receipt stitcher isn't an ad-hoc script—it is the direct application of three battle-tested industry foundations:

```mermaid
flowchart LR
    subgraph Inbound["Incoming Shard Receipts"]
        R0["Receipt R0"]
        R1["Receipt R1"]
        R2["Receipt R2"]
    end

    subgraph Aggregator["NearHook Stitcher (Stateful Aggregator)"]
        direction TB
        C1["1. Match Correlation ID<br/>Group receipts by tx_hash"]
        C2["2. Check Completeness<br/>Spawned − Executed = 0"]
        C3["3. Package Event<br/>Verify refunds & Ed25519 sign"]
        C1 --> C2 --> C3
    end

    Inbound --> Aggregator
    Aggregator --> Out["Verified Webhook"]

    style Aggregator fill:#0B0F17,stroke:#9945FF,stroke-width:2px,color:#fff
    style Inbound fill:#111827,stroke:#3B82F6,stroke-width:1px,color:#fff
    style Out fill:#064E3B,stroke:#00EC97,stroke-width:2px,color:#fff
```

1. **The Stateful Aggregator (Enterprise Integration Patterns):**  
   In enterprise messaging, when an event splits across multiple systems, a *Stateful Aggregator* does three simple jobs:
   * **Correlation ID:** Groups every shard receipt under its parent transaction (`tx_hash`).
   * **Completeness Check:** Holds the event in memory until every child receipt arrives (`Spawned − Executed = 0`), backed by a safety timeout.
   * **Aggregation:** Combines all receipt outcomes into one canonical, verified JSON webhook.

2. **Tail-Based Assembly (OpenTelemetry Distributed Tracing):**  
   In microservices, tracing systems track requests bouncing across dozens of independent services. Naive indexers make "head-based" decisions—firing as soon as the first step starts. NearHook uses **tail-based assembly**: it buffers the trace until the very end (the "tail") to check whether any downstream call failed or refunded before notifying your backend.

3. **Data-Driven Triggers (Google Dataflow Model):**  
   Instead of a dumb timer that waits an arbitrary 5 seconds, NearHook separates *when pieces arrive* from *when the result is ready*. The transaction window closes the exact millisecond the final receipt settles, delivering the lowest possible latency.

---

## 5. Multi-Chain Settlement in One Webhook

Instead of managing node providers and indexers across 35+ chains, NearHook translates NEAR's cross-chain contracts into clear, human-readable events:

```mermaid
flowchart TD
    Chains["35+ Blockchains<br/>(Bitcoin, Solana, Ethereum, Base, TON)"] ==>|"Cross-Chain Swaps & Signing"| NEAR["NEAR Clearinghouses<br/>• intents.near (swaps & balances)<br/>• v1.signer (MPC threshold signatures)"]
    NEAR ==>|"Receipts & Event Logs"| NearHook["NearHook Engine<br/>• Stitches multi-shard receipts<br/>• Verifies settlement & refunds<br/>• Signs payload with Ed25519"]
    NearHook -->|"Live HTTPS POST"| Cloud["Cloud Backends (Next.js, FastAPI, Lambda)"]
    NearHook -->|"CLI Tunnel Stream"| Tunnel["Local Dev & AI Agents (`nearhook listen`)"]

    style NEAR fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style NearHook fill:#0B0F17,stroke:#9945FF,stroke-width:2px,color:#fff
    style Cloud fill:#111827,stroke:#3B82F6,stroke-width:1px,color:#fff
    style Tunnel fill:#111827,stroke:#F59E0B,stroke-width:1px,color:#fff
```

* **NEAR Intents (`intents.near`):** Parses NEP-297 `token_diff` logs, turning raw addresses like `nep141:sol.omft.near` into clean metadata (`SOLANA`, `15.0 SOL`).
* **Chain Signatures (`v1.signer`):** Correlates sign requests with asynchronous MPC callbacks, delivering ready-to-broadcast foreign signatures.

---

## 6. Security: Verifying Incoming Webhooks

NearHook secures every delivery using native Ed25519 cryptographic signatures:

```mermaid
flowchart LR
    Incoming["Incoming Webhook"] --> TimeCheck{"1. Timestamp<br/>Within 5 mins?"}
    TimeCheck -- "Pass" --> DedupCheck{"2. Seen before?<br/>Check event_id"}
    DedupCheck -- "New" --> SigCheck{"3. Signature Check<br/>Pinned Public Key"}
    SigCheck -- "Valid" --> Accept["✅ 200 OK<br/>Process Event"]

    TimeCheck -- "Fail" --> Reject1["❌ Reject: Expired"]
    DedupCheck -- "Seen" --> Reject2["❌ Reject: Replay Attack"]
    SigCheck -- "Fail" --> Reject3["❌ Reject: Tampered"]

    style Incoming fill:#111827,stroke:#3B82F6,stroke-width:2px,color:#fff
    style Accept fill:#064E3B,stroke:#00EC97,stroke-width:2px,color:#fff
    style Reject1 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Reject2 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Reject3 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
```

1. **Ed25519 Signatures:** Payloads are signed with the relayer's private key. Your server checks it against NearHook's pinned public key.
2. **Replay Protection:** Unique `X-NearHook-Id` headers allow your server to reject duplicate requests sent within the 5-minute window.

---

## 7. Zero-Config Local Tunneling (`nearhook listen`)

Developers and AI engineers can develop locally without port-forwarding or paying for ngrok:

```bash
npx nearhook listen --account "*.myapp.near" --forward http://localhost:3000/api/webhook
```

```mermaid
sequenceDiagram
    autonumber
    participant CLI as Developer CLI (nearhook listen)
    participant Hub as NearHook Cloud Hub
    participant Local as Local Server (localhost:3000)

    CLI->>Hub: 1. Connects outbound via persistent WebSocket
    Note over Hub: Receipt tree resolves on NEAR shards
    Hub->>CLI: 2. Pushes verified event
    CLI->>CLI: 3. Verifies Ed25519 signature locally
    CLI->>Local: 4. Forwards HTTP POST to localhost:3000
    Local-->>CLI: 5. Returns 200 OK (18ms)
    CLI->>CLI: 6. Prints formatted delivery log in terminal
```

* **Firewall Traversal:** Uses an outbound WebSocket connection—no router changes or static IPs needed.
* **1-Click Free Replay:** If your local server crashes during testing, click **Replay** in the dashboard to re-send the exact payload without paying gas on NEAR.

---

## 8. Example Webhook Payload

When a cross-chain swap or intent settles on NEAR, your backend or AI agent receives this clean JSON payload:

```json
{
  "event_id": "evt_99214a8b3c",
  "event_type": "INTENT_SETTLED",
  "settlement": {
    "tx_hash": "8kL9v7m2xPqR4tY9uW1zK3nM5pQ7vB2cX4zL9mN1pQr",
    "blocks_spanned": 3,
    "protocol_status": "SUCCESS",
    "business_status": "CONFIRMED"
  },
  "route": {
    "source_chain": "SOLANA",
    "source_amount": "15.0 SOL",
    "destination_chain": "BITCOIN",
    "destination_amount": "0.0285 BTC",
    "destination_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
  },
  "attestation": {
    "relayer_public_key": "ed25519:3N8xZ2LkdIwHu7ix9pLm...",
    "timestamp": 1762849200
  }
}
```

* **`protocol_status` (`SUCCESS`):** Confirms that all smart contract calls resolved without unhandled WebAssembly execution panics.
* **`business_status` (`CONFIRMED` vs `REFUNDED`):** Confirms whether the actual business operation succeeded or if a resolver callback (such as `ft_resolve_transfer`) returned the funds to the sender.

---

## 9. Summary: FastNEAR Directly vs. With NearHook

| Capability | Consuming FastNEAR Directly | Consuming NearHook |
| :--- | :--- | :--- |
| **Data Format** | Raw 5MB network dump of every block | Clean, filtered JSON payload for *your* contract |
| **Delivery Mechanism** | You must run continuous `while(true)` polling | Standard **HTTP POST Webhook** pushed to you |
| **Receipt Stitching** | **None.** You must write code to track multi-block receipts | **Automatic.** NearHook holds dispatch until terminal settlement |
| **Refund Detection** | You must parse raw contract callbacks manually | Webhook explicitly says `CONFIRMED` vs `REFUNDED` |
| **Gas Refund Latency** | Waits 1 extra block (~1.1s) for gas change receipts | **Prunes gas change receipts** for faster sub-second dispatch |
| **Compute Cost** | Pay 24/7 for servers running continuous polling loops | **$0 idle cost.** Serverless & agents wake up only when needed |
| **Local Dev (`localhost:3000`)**| Impossible without ngrok or custom proxies | **Built-in tunnel (`npx nearhook listen`)** |
| **Historical Replay** | Re-run on-chain transactions and pay gas | **1-click free replay** from durable event logs |
| **Cryptographic Security** | Raw unsigned HTTP data | Signed with **Ed25519** with replay protection |
