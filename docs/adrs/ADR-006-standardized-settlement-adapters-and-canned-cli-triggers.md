# ADR-006: Standardized Settlement Adapters and Canned CLI Triggers

## Status
Accepted

## Context
1. **Generic Refund Detection is Impossible:** Smart contracts on NEAR can implement arbitrary internal logic. Claiming that a system can magically detect refunds on any arbitrary contract without understanding its interface is technically inaccurate. NEAR has well-defined interface standards: `NEP-141` (Fungible Tokens), `NEP-245` (Multi-Tokens), and `DIP-4` (Intents).
2. **Local Testing Friction:** Developers testing webhook endpoints hate waiting for testnet faucets, deploying contracts, or paying gas just to test whether their backend handles a refund callback properly. Stripe solved this with the Stripe CLI (`stripe trigger`).

## Decision
1. **Standardized Settlement Adapters:** NearHook models business refund conditions through explicit domain adapters:
   - `NEP-141 Adapter`: Evaluates `ft_transfer_call` $\rightarrow$ `ft_on_transfer` $\rightarrow$ `ft_resolve_transfer`. Inspects the integer return value of `ft_resolve_transfer` and `ft_transfer` logs to determine tokens returned.
   - `NEP-245 Adapter`: Evaluates `mt_transfer_call` and `mt_resolve_transfer` batch returns.
   - `DIP-4 Adapter`: Parses NEP-297 `token_diff` logs from `intents.near` to verify cross-chain asset swaps.
2. **Canned CLI Trigger Engine (`nearhook trigger`):**
   - The developer CLI ships with pre-recorded, canonical multi-shard receipt DAGs:
     - `payment.succeeded`: Normal 2-block confirmation.
     - `payment.refunded`: 3-block sequence with `ft_on_transfer` panic and `ft_resolve_transfer` refund.
     - `intent.settled`: DIP-4 multi-token diff settlement.
   - `nearhook trigger` executes the real in-memory DAG engine in-process and emits the signed webhook directly to the local forward target (`localhost:3000`) with 0 network latency and 0 gas cost.

## Consequences
- **Positive:** Honest, rigorous protocol modeling. Demonstrates deep understanding of NEAR standards rather than hand-waving claims.
- **Positive:** World-class developer experience. Allows automated CI tests and developers to test refund handlers in 5 seconds.
- **Positive:** 100% reliable hackathon demo that cannot fail due to testnet congestion.

