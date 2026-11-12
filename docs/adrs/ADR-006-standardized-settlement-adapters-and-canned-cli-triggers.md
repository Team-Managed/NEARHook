# ADR-006: Standardized Settlement Adapters and Captured Receipt Replay

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
2. **Captured Receipt Replay (`nearhook trigger`):**
   - Complete the reference-contract work in Ticket 09 first and capture receipt traces from actual Testnet transactions.
   - Store versioned fixtures with transaction provenance. Do not invent receipt outcomes or encode expected business statuses in the CLI.
   - `nearhook trigger --fixture <path>` replays the captured outcomes through the real in-memory DAG engine and emits an explicitly marked test payload. Replay itself requires no RPC calls or gas.
   - Synthetic receipt data is allowed in unit-test setup only; those tests must run the real core evaluator and label the data synthetic.

## Consequences
- **Positive:** Honest, rigorous protocol modeling. Demonstrates deep understanding of NEAR standards rather than hand-waving claims.
- **Positive:** Developers can repeatedly test handlers against a real captured trace without waiting for Testnet.
- **Positive:** CI can validate settlement logic with small, explicitly synthetic unit-test inputs without presenting them as live transactions.
- **Negative:** The first integration traces require the reference contract to be built and exercised on Testnet.

