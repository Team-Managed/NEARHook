# NearHook Domain Glossary

This glossary defines core domain terminology for NearHook, NEAR Protocol's asynchronous execution model, and clearinghouse integrations.

---

### Core Concepts

#### Receipt (`Receipt`)
The atomic asynchronous message packet on NEAR Protocol. A transaction submitted to NEAR does not execute cross-contract calls atomically in a single block; instead, it generates one or more execution receipts that route to target shards and execute in subsequent blocks.

#### ExecutionOutcomeWithId
The outcome of executing a receipt on a specific shard at a specific block height. It contains:
- `receipt_ids`: Array of new receipt IDs spawned by this receipt (child promises).
- `status`: Execution status (`SuccessReceiptId`, `SuccessValue`, or `Failure`).
- `logs`: Array of UTF-8 log strings emitted during execution (e.g. `EVENT_JSON:`).
- `gas_burnt`: Gas consumed during execution.

#### Receipt Dependency Graph ($G_T = (V_T, E_T)$)
The causal execution graph of a NEAR transaction $T$:
- **Vertices ($V_T$):** Each vertex is a receipt execution outcome (`ReceiptExecution`).
- **Edges ($E_T$):** Directed causal dependencies, distinguishing promise spawns ($E_{\text{spawn}}$) from callback dependencies ($E_{\text{callback}}$).

#### Optimistic Settlement Vulnerability
A correctness vulnerability where an indexer or listener triggers an off-chain callback or releases funds upon observing a parent receipt success at block $B_t$, unaware that a child cross-contract promise will fail at block $B_{t+1}$ and trigger a refund callback at block $B_{t+2}$.

#### Terminal Resolution Condition
The state where:
1. The root receipt has executed.
2. Every discovered child promise has executed.
3. Every registered callback has executed.
4. The block heights of all constituent receipts are confirmed in the indexer's contiguous checkpoint log.

#### Protocol Status vs. Business Status
- **Protocol Status:** Technical runtime result of the receipt execution graph (`SUCCESS` vs unhandled runtime panic `FAILURE`).
- **Business Status:** Application-level settlement outcome (e.g. `CONFIRMED` payment vs `REFUNDED` payment detected via `ft_resolve_transfer` callback return value and `NEP-297` transfer logs).

#### Contract Callback / Resolver (`ft_resolve_transfer`)
In NEAR's NEP-141 standard, when `ft_transfer_call` invokes `ft_on_transfer` on a recipient, it registers `ft_resolve_transfer` as a contract callback. If the recipient panics, the callback executes, inspects `env::promise_result(0)`, returns unused tokens to the sender, and emits refund events. The callback itself succeeds at the protocol level while representing a refund at the business level.

#### NEAR Clearinghouses
Decentralized contracts on NEAR that settle multi-chain state:
- `intents.near`: NEAR Intents Verifier executing cross-chain asset swaps and withdrawals via the DIP-4 / NEP-297 event standard.
- `v1.signer`: Threshold Multi-Party Computation (MPC) contract generating decentralized threshold signatures (Secp256k1 for EVM/BTC, Ed25519 for Solana/TON).

#### NEP-297 & DIP-4
- **NEP-297:** The official NEAR Event Standard specifying structured JSON logs prefixed with `EVENT_JSON:`.
- **DIP-4:** Decentralized Intent Protocol standard identifier used within NEP-297 (`standard: "dip4"`) for intent state transitions and token diffs.

#### Public Key Pinning
A security requirement where webhook receivers verify signatures against a pre-configured or pinned public key from NearHook, rejecting dynamically supplied public keys in HTTP headers to prevent relayer spoofing.

#### Event Idempotency Key
The unique `X-NearHook-Id` used by webhook receivers to track delivered events and reject replays of valid payloads within the timestamp tolerance window.
