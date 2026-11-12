# ADR-004: Two-Way Webhooks via Native NEAR yield_create and yield_resume

## Status
Accepted

## Context
Smart contracts on most blockchains (Ethereum, Solana) cannot initiate outbound HTTP calls or await external API responses. NEAR Protocol introduced native WebAssembly host functions `yield_create` and `yield_resume`. When a contract calls `yield_create`, its execution state is frozen and serialized on-chain, and an execution receipt is emitted with a 200-block timeout (~2 minutes). Execution cannot resume until `yield_resume` is called with the matching data payload.

Existing webhook solutions (QuickNode, Alchemy) are strictly one-way notification pipes. They cannot participate in smart contract execution or provide bidirectional communication.

## Decision
NearHook will support **Two-Way Webhooks** by integrating directly with NEAR's `yield_create` and `yield_resume` host functions:
1. When the Ingestion Engine detects an execution outcome containing a `yield_create` promise, NearHook models it in the DAG as a `YIELDED` node.
2. NearHook dispatches an HTTPS POST webhook to the user's subscribed endpoint with the contract's yield payload.
3. The user's server processes the event and returns an HTTP 200 response with an authorization/data payload (e.g. `{ approved: true, discount: 10 }`).
4. NearHook cryptographically signs the reply and issues an on-chain transaction calling `yield_resume`, unfreezing the smart contract on NEAR.

## Consequences
- **Positive:** Leverages a unique, protocol-level primitive of NEAR Protocol. Elevates NearHook from a passive indexer to an interactive execution oracle.
- **Positive:** Eliminates custom off-chain relayer scripts for developers who need smart contracts to check external APIs (KYC, off-chain pricing, inventory).
- **Negative:** Yielded receipts can stay open for up to 200 blocks (~2 minutes). The in-memory DAG tracker must maintain an extended TTL for yielded transactions rather than the standard 120s timeout.

