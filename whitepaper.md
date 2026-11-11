# NearHook: Asynchronous Receipt-Aware Event Delivery & Local Tunneling for NEAR Protocol

**Technical Whitepaper** • Version 2.1 • November 2026  
**Category:** Developer Infrastructure / Event Ingress / NEAR Protocol  

---

## Abstract

Consuming state transitions on NEAR Protocol introduces a fundamental correctness challenge absent in single-block atomic chains: **Nightshade asynchronous sharding**. A single transaction decomposes into a tree of cross-shard execution receipts (`Receipt`) resolving across 2 to 4+ consecutive blocks. Naive indexers triggering callbacks upon root transaction inclusion suffer from **Optimistic Settlement Vulnerabilities**: a parent receipt succeeds at block $B_t$, but a child cross-contract promise panics at block $B_{t+1}$, causing a contract callback to issue a refund at block $B_{t+2}$.

**NearHook** is a developer-first, receipt-aware event delivery gateway and local tunneling protocol for NEAR. It provides:
1. **Receipt Dependency Tracking:** Traces parent-child promises and callback dependencies across shards, withholding dispatch until terminal settlement is provably complete.
2. **Dual-Axis Settlement Evaluation:** Separates technical protocol outcomes from business settlement (distinguishing confirmed transfers from deliberate `ft_resolve_transfer` refund callbacks).
3. **NEAR Clearinghouse Ingress:** Ingress for multi-chain activity settling via NEAR Intents (`intents.near` NEP-297/DIP-4) and MPC Chain Signatures (`v1.signer`).
4. **Attested Delivery & Zero-Config Tunneling:** Ed25519 payload signatures with public key pinning, event idempotency, durable PostgreSQL `JSONB` replay, and instant local delivery via `npx nearhook listen`.

---

## 1. The Problem: Asynchronous Sharding & Optimistic Settlement

Monolithic blockchains execute transactions atomically in a single block. NEAR partitions state across independent shards ($S_0, S_1, \dots, S_k$), decoupling transaction submission from execution through asynchronous **Receipts**.

When contracts interact across shards, downstream callbacks resolve blocks after the initiating receipt:

```mermaid
sequenceDiagram
    autonumber
    actor User as User / AI Agent
    participant Shard1 as Shard 1 (intents.near)
    participant Shard3 as Shard 3 (usdc.near)
    participant Shard2 as Shard 2 (merchant.near)
    participant Client as Merchant Backend

    Note over Shard1: Block B_101
    User->>Shard1: Transaction T: Execute transfer-call
    Shard1->>Shard1: Deduct balance & emit log
    Note right of Shard1: Naive indexer fires "Payment Received" HERE! ⚠️
    Shard1-->>Client: ❌ Premature Webhook (Optimistic Vulnerability)
    Shard1->>Shard3: Spawn Promise Receipt R_1 (ft_transfer_call)

    Note over Shard3: Block B_102
    Shard3->>Shard3: Decrement sender, credit merchant
    Shard3->>Shard2: Spawn Promise Receipt R_2 (ft_on_transfer)
    Shard3->>Shard3: Register Callback Receipt R_3 (ft_resolve_transfer)

    Note over Shard2: Block B_103
    Shard2--xShard2: PANIC: Out of Stock / Order Expired!
    Shard2-->>Shard3: Return Failure(ActionError)

    Note over Shard3: Block B_104
    Shard3->>Shard3: Execute Callback Receipt R_3 (ft_resolve_transfer)
    Shard3->>Shard3: Inspects promise result (Failed) & refunds sender
    Note over Shard3: Transfer Refunded! Tokens returned to sender.
```

If an indexer fires on $R_0$'s inclusion, the merchant releases off-chain goods for a payment that is rolled back two blocks later.

---

## 2. Receipt Dependency Tracking & Dual-Axis Settlement

### 2.1 Receipt Dependency Graph ($G_T$)

NearHook models execution as a dynamic Directed Acyclic Graph:

$$G_T = (V_T, E_T)$$

* **Vertices ($V_T$):** Unique `ReceiptId` outcomes (`ReceiptExecution`).
* **Edges ($E_T$):** Typed causal links:
  * **Promise Spawns ($E_{\text{spawn}}$):** Parent receipt $u$ spawns child $v$ via `outcome.receipt_ids`.
  * **Callback Dependencies ($E_{\text{callback}}$):** Callback $w$ waits for promise $v$ to return a `PromiseResult`.

```mermaid
flowchart TD
    subgraph B101["Block B_101 • Shard 1"]
        R0["Receipt R_0<br/><b>intents.near</b><br/>execute_intents<br/><i>Status: SuccessReceiptId(R_1)</i>"]
    end

    subgraph B102["Block B_102 • Shard 3"]
        R1["Receipt R_1<br/><b>usdc.near</b><br/>ft_transfer_call<br/><i>Status: SuccessReceiptId(R_2)</i>"]
    end

    subgraph B103["Block B_103 • Shard 2"]
        R2["Receipt R_2<br/><b>merchant.near</b><br/>ft_on_transfer<br/><i>Status: Failure(ActionError)</i>"]
    end

    subgraph B104["Block B_104 • Shard 3"]
        R3["Receipt R_3 (Callback)<br/><b>usdc.near</b><br/>ft_resolve_transfer<br/><i>Status: SuccessValue(refunded)</i>"]
    end

    R0 ==>|"E_spawn (Promise)"| R1
    R1 ==>|"E_spawn (Promise)"| R2
    R1 -.->|"E_callback (Registered Callback)"| R3
    R2 ==>|"Yields PromiseResult::Failed"| R3

    style R0 fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style R1 fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style R2 fill:#111827,stroke:#F43F5E,stroke-width:2px,color:#fff
    style R3 fill:#111827,stroke:#F59E0B,stroke-width:2px,color:#fff
```

### 2.2 Terminal Resolution Condition

A transaction $T$ is **Terminally Resolved** only when:
1. Root receipt $v_{\text{root}}$ has executed.
2. All discovered child promises have executed.
3. All registered callbacks have executed.
4. Block heights for all $v \in V_T$ are confirmed in the indexer's contiguous checkpoint log.

### 2.3 Dual-Axis Settlement Semantics

A downstream promise failure does not imply overall transaction failure: NEAR smart contracts deliberately use callbacks like `ft_resolve_transfer` to handle recipient errors cleanly. NearHook evaluates outcomes along two axes:

| Status Axis | Value | Meaning |
| :--- | :--- | :--- |
| **`protocol_status`** | `SUCCESS` | Receipt tree completed without unhandled runtime panics. |
| | `FAILURE` | Unhandled runtime panic or invalid action error occurred. |
| **`business_status`** | `CONFIRMED` | Primary operation succeeded (e.g. transfer cleared). |
| | `REFUNDED` | Downstream promise failed; resolver callback refunded tokens. |
| | `FAILED` | Transaction aborted before resolution. |

---

## 3. NEAR Clearinghouse Ingress (`intents.near` & `v1.signer`)

NearHook provides normalized ingress for multi-chain activity settling on NEAR's native clearinghouses:

```mermaid
flowchart TD
    subgraph External["External Blockchains (35+ Networks)"]
        BTC["Bitcoin & UTXO (BTC, DOGE)"]
        EVM["EVM L1 & L2 (Ethereum, Base, Arbitrum)"]
        NonEVM["Non-EVM (Solana, TON, Sui)"]
    end

    subgraph Clearinghouse["NEAR Clearinghouses"]
        Intents["<b>intents.near</b><br/>• DIP-4 / NEP-297 event logs<br/>• token_diff & Omni-Bridge balances"]
        Signer["<b>v1.signer</b><br/>• Secp256k1 & Ed25519 MPC<br/>• Foreign transaction signatures"]
    end

    subgraph NearHook["NearHook Ingestion & Dispatch"]
        Poller["Checkpointed FastNEAR Poller"]
        Tracker["Receipt Dependency Tracker"]
        Evaluator["Settlement Evaluator"]
        Normalizer["Omnichain Normalizer"]
        Attestation["Ed25519 Relayer Signer"]
    end

    subgraph Ingress["Delivery Targets"]
        CloudWebhook["Mode A: HTTPS Webhook"]
        CLITunnel["Mode B: CLI Local Tunnel"]
        AIAgent["Mode C: AI Agent ($0 Idle)"]
    end

    BTC & EVM & NonEVM ==>|"Cross-Chain Swaps & Deposits"| Intents
    BTC & EVM & NonEVM ==>|"Foreign Signing Requests"| Signer
    Intents & Signer ==> Poller
    Poller --> Tracker --> Evaluator --> Normalizer --> Attestation
    Attestation --> CloudWebhook & CLITunnel & AIAgent

    style Intents fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style Signer fill:#111827,stroke:#9945FF,stroke-width:2px,color:#fff
    style NearHook fill:#0B0F17,stroke:#1F2937,stroke-width:1px,color:#fff
    style CloudWebhook fill:#111827,stroke:#3B82F6,stroke-width:2px,color:#fff
    style CLITunnel fill:#111827,stroke:#F59E0B,stroke-width:2px,color:#fff
    style AIAgent fill:#111827,stroke:#10B981,stroke-width:2px,color:#fff
```

* **NEAR Intents (`intents.near`):** Parses `EVENT_JSON:` logs (`standard: "dip4"`, `event: "token_diff"`), resolving Omni-Bridge contracts (`nep141:sol.omft.near`, `nep141:btc.omft.near`) into chain identifiers and formatted decimal amounts.
* **Chain Signatures (`v1.signer`):** Correlates initial `sign` request receipts with asynchronous MPC callbacks emitting threshold signature components (`big_r`, `s`).

---

## 4. Cryptographic Security & Attestation

### 4.1 Signing Pre-Image
Payloads are signed with the relayer's private Ed25519 key over canonical pre-image:
$$M = \tau \parallel "." \parallel B$$
where $\tau$ is Unix epoch seconds and $B$ is the serialized JSON body.

Headers attached:
- `X-NearHook-Id: evt_...` (Unique event ID)
- `X-NearHook-Timestamp: <tau>`
- `X-NearHook-Signature: ed25519:<hex>`

### 4.2 Secure Receiver Verification Sequence

```mermaid
flowchart TD
    Start["Incoming Webhook"] --> HeaderCheck{"Headers Present?<br/>Id, Timestamp, Sig"}
    HeaderCheck -- "No" --> Reject1["❌ 400 Bad Request"]
    HeaderCheck -- "Yes" --> FreshnessCheck{"Freshness Check<br/>|now - tau| <= 300s"}
    FreshnessCheck -- "No" --> Reject2["❌ 401 Unauthorized (Expired)"]
    FreshnessCheck -- "Yes" --> IdempotencyCheck{"Idempotency Cache<br/>Has event_id been seen?"}
    IdempotencyCheck -- "Yes" --> Reject3["❌ 409 Conflict (Replay Blocked)"]
    IdempotencyCheck -- "No" --> CryptoCheck{"Ed25519 Verify<br/>Against PINNED Public Key"}
    CryptoCheck -- "Invalid" --> Reject4["❌ 403 Forbidden (Tampered)"]
    CryptoCheck -- "Valid" --> Accept["✅ 200 OK<br/>Store event_id (TTL 600s) & Process"]

    style Start fill:#111827,stroke:#3B82F6,stroke-width:2px,color:#fff
    style Reject1 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Reject2 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Reject3 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Reject4 fill:#450A0A,stroke:#F43F5E,stroke-width:1px,color:#fff
    style Accept fill:#064E3B,stroke:#00EC97,stroke-width:2px,color:#fff
```

* **Public Key Pinning:** Clients pin the NearHook relayer public key via environment variables; dynamic public keys in request headers are strictly rejected to eliminate relayer spoofing.
* **Event Idempotency:** Duplicate `X-NearHook-Id` values within the 300s window are rejected to prevent replay attacks.

---

## 5. Ingestion Engine & Storage Architecture

### 5.1 Checkpointed FastNEAR Poller

FastNEAR’s NEARDATA is an **HTTP query API**, not a streaming socket. NearHook runs a checkpointed polling loop enforcing contiguous height processing:

```mermaid
flowchart TD
    ReadCheckpoint["1. Read Checkpoint H_last"] --> PollLatest["2. Poll /v0/last_block/optimistic"]
    PollLatest --> GapCheck{"3. H_current > H_last + 1?"}
    GapCheck -- "Yes" --> EnqueueGaps["Enqueue Missing Heights"]
    GapCheck -- "No" --> FetchBlock["4. Fetch /v0/block_opt/{height}"]
    EnqueueGaps --> FetchBlock
    FetchBlock --> Extract["5. Parse Receipts & Logs"]
    Extract --> UpdateTracker["6. Update Receipt Tracker"]
    UpdateTracker --> CheckpointWrite["7. Persist Checkpoint H_last = height"]
    CheckpointWrite --> PollLatest

    style ReadCheckpoint fill:#111827,stroke:#3B82F6,stroke-width:2px,color:#fff
    style PollLatest fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style GapCheck fill:#111827,stroke:#F59E0B,stroke-width:2px,color:#fff
    style EnqueueGaps fill:#111827,stroke:#F59E0B,stroke-width:1px,color:#fff
    style FetchBlock fill:#111827,stroke:#3B82F6,stroke-width:2px,color:#fff
    style Extract fill:#111827,stroke:#00EC97,stroke-width:2px,color:#fff
    style UpdateTracker fill:#111827,stroke:#9945FF,stroke-width:2px,color:#fff
    style CheckpointWrite fill:#064E3B,stroke:#00EC97,stroke-width:2px,color:#fff
```

### 5.2 Two-Tier Storage Architecture

1. **Ephemeral Hot Memory (Redis, 120s TTL):** Buffers in-flight receipts and causal dependencies during the multi-block resolution window. Purged upon terminal handoff.
2. **Durable Store (PostgreSQL / NeonDB):**
   * `subscriptions`: Wildcard routing (`*.app.near`), chain filters, target URLs.
   * `deliveries`: Stitched canonical JSON payloads (`JSONB`), HTTP status codes, latencies, and attempt counts. Powers **1-click gas-free replay**.

### 5.3 Delivery Pipeline & Circuit Breaker

Failed deliveries ($\ge 400$ or $>5000\text{ms}$) retry with jittered exponential backoff (1s, 3s, 9s, 27s, 81s).

```mermaid
stateDiagram-v2
    [*] --> ACTIVE: Endpoint Configured
    ACTIVE --> ACTIVE: 2xx Success (Reset fail counter)
    ACTIVE --> ACTIVE: Error >= 400 (Exponential Retry 1s..81s)
    ACTIVE --> PAUSED_UNHEALTHY: 10 Consecutive Failures OR >95% Failure Rate
    PAUSED_UNHEALTHY --> RECOVERING: Manual Reset / Probe
    RECOVERING --> ACTIVE: Test Delivery Succeeds (200 OK)
    RECOVERING --> PAUSED_UNHEALTHY: Test Delivery Fails
```

---

## 6. Zero-Config Local Tunneling (`nearhook listen`)

Developers test webhook handlers behind firewalls without ngrok or port-forwarding:

```mermaid
sequenceDiagram
    autonumber
    participant Engine as NearHook Engine
    participant Hub as Tunnel Hub (WebSocket Server)
    participant CLI as Developer CLI (nearhook listen)
    participant Local as Localhost Server (localhost:3000)

    CLI->>Hub: 1. Outbound WebSocket Connection (Auth & Filter Rules)
    Hub-->>CLI: 2. WebSocket Connected & Stream Ready
    Note over Engine,Hub: Verified receipt tree resolves on NEAR shards
    Engine->>Hub: 3. Dispatch finalized event with Ed25519 signature
    Hub->>CLI: 4. Stream event payload over WebSocket
    Note over CLI: 5. Verify Ed25519 Signature against Pinned Relayer Key
    CLI->>Local: 6. Forward HTTP POST to http://localhost:3000/api/webhook
    Local-->>CLI: 7. Response: 200 OK (18ms)
    CLI-->>Hub: 8. Report Status & Round-trip Latency
    CLI->>CLI: 9. Print formatted delivery log in console
```

---

## 7. Canonical Webhook Payload

```json
{
  "event_id": "evt_01h8x4a9k7z2m3n4p5q6r7s8t9",
  "event_type": "INTENT_SETTLEMENT_COMPLETED",
  "finality": "OPTIMISTIC",
  "subscription": {
    "id": "sub_99214a",
    "account_filter": "intents.near",
    "chain_filter": ["SOLANA", "BITCOIN"]
  },
  "settlement": {
    "origin_tx_hash": "8kL9v7m2xPqR4tY9uW1zK3nM5pQ7vB2cX4zL9mN1pQr",
    "root_receipt_id": "4fG1b89aBcDeF2gH3iJ4kL5mN6oP7qR8sT9uV0wXyZ1",
    "start_block_height": 142890120,
    "final_block_height": 142890122,
    "blocks_spanned": 3,
    "total_gas_burnt_tgas": 14.8,
    "protocol_status": "SUCCESS",
    "business_status": "CONFIRMED"
  },
  "receipt_tree": {
    "root_receipt_id": "4fG1b89aBcDeF2gH3iJ4kL5mN6oP7qR8sT9uV0wXyZ1",
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
    "dependencies": [
      { "parent": "4fG1b8...XyZ1", "child": "9aBc2d...LmN4", "type": "PROMISE" },
      { "parent": "9aBc2d...LmN4", "child": "7xKp93...QrS8", "type": "PROMISE" }
    ]
  },
  "omnichain_settlement": {
    "clearinghouse": "intents.near",
    "standard": "NEP-297",
    "standard_version": "dip4:0.3.0",
    "source_chain": "SOLANA",
    "source_token": "nep141:sol.omft.near",
    "source_amount_formatted": "15.0 SOL",
    "destination_chain": "BITCOIN",
    "destination_token": "nep141:btc.omft.near",
    "destination_amount_formatted": "0.0285 BTC",
    "destination_address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
  },
  "attestation": {
    "relayer_public_key": "ed25519:3N8xZ2LkdIwHu7ix9pLmQ4vB7nM2kP8xR1tY5uW9zQ2...",
    "timestamp": 1762849200
  }
}
```

---

## 8. Latency Design Targets

| Stage | Mechanism | Target Latency |
| :--- | :--- | :--- |
| **Block Polling** | FastNEAR HTTP polling (1s interval) | $200\text{ms} - 500\text{ms}$ |
| **Receipt Tracking** | In-Memory / Redis Hash operations | $<5\text{ms}$ per chunk |
| **Terminal Check** | Pure DAG dependency evaluator | $<1\text{ms}$ |
| **Attestation** | Ed25519 signing (`@noble/curves`) | $<0.5\text{ms}$ |
| **Dispatch** | Outbound HTTP POST / WebSocket stream | $15\text{ms} - 50\text{ms}$ |

*Formal benchmarks across 10,000 synthetic multi-shard transactions will be published in a companion technical evaluation report.*

---

## References

1. Skidanov, A., & Polosukhin, I. (2019). *Nightshade: Consensus and sharding specification for NEAR Protocol*.
2. NEAR Protocol Docs. *Receipts and Cross-Contract Calls*. https://docs.near.org
3. NEAR Enhancement Proposals. *NEP-141: Fungible Token Standard* & *NEP-297: Event Standard*.
4. Decentralized Intent Protocol. *DIP-4: Multi-Token Event Standards for intents.near*.
5. FastNEAR. *NEARDATA API Documentation*. https://docs.fastnear.com
