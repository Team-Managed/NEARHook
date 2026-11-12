# NEAR reference contracts

## Minimal two-minute demo

For the short demo, deploy only `two-way-hook`. You need a funded account for the contract and a different account for the responder; the responder can also be the owner and requester. The contract rejects its own account as responder.

```sh
cargo near deploy build-non-reproducible-wasm --manifest-path packages/contracts/two-way-hook/Cargo.toml <HOOK_CONTRACT>.testnet with-init-call new json-args '{"owner_id":"<RESPONDER>.testnet","responder_id":"<RESPONDER>.testnet"}' network-config testnet sign-with-keychain send
```

Then follow the request and resume commands in [`demo.md`](../../demo.md). The merchant escrow and a token contract are not needed for this demo.

Ticket 09 provides two Rust contracts for the NearHook receipt and yield demos:

- `merchant-escrow` is a NEP-141 transfer-call receiver. Its constructor takes the one accepted FT contract account ID.
- `two-way-hook` creates one yield per action and accepts resumes from a configured responder. Its constructor takes `owner_id` and `responder_id`.

## Prerequisites

Install Rust with the `wasm32-unknown-unknown` target, `cargo-near`, pnpm, and `near-cli-rs`. The generated contract projects pin the supported Rust toolchain in their `rust-toolchain.toml` files.

From the repository root:

```sh
pnpm --dir packages/contracts test
pnpm --dir packages/contracts build
```

Build artifacts are emitted under each contract's `target/` directory. These build commands produce non-reproducible WASM for development and testnet demos.

## Optional: deploy both reference contracts

Use this path only when demonstrating both contract examples. Authenticate `near-cli-rs` with funded Testnet accounts. `with-init-call` deploys and initializes in one transaction:

```sh
cargo near deploy build-non-reproducible-wasm --manifest-path packages/contracts/merchant-escrow/Cargo.toml merchant-escrow.testnet with-init-call new json-args '{"ft_contract_id":"<NEP141_TOKEN_ACCOUNT>.testnet"}' network-config testnet sign-with-keychain send
cargo near deploy build-non-reproducible-wasm --manifest-path packages/contracts/two-way-hook/Cargo.toml two-way-hook.testnet with-init-call new json-args '{"owner_id":"<OWNER_ACCOUNT>.testnet","responder_id":"<RESPONDER_ACCOUNT>.testnet"}' network-config testnet sign-with-keychain send
```

Replace placeholder accounts with accounts you control. The merchant escrow example needs a separately deployed NEP-141 token contract; configure that token to call the escrow with `ft_transfer_call` before exercising the receiver callback.

## Call methods

Create an action yield (attach enough NEAR to cover pending storage):

```sh
near contract call-function as-transaction two-way-hook.testnet request_action json-args '{"action_id":"demo-order-1"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as '<REQUESTER_ACCOUNT>.testnet' network-config testnet sign-with-keychain send
```

Read `yield_created` in the transaction logs for its `request_id` and `yield_token`. The configured responder resumes using the request ID:

```sh
near contract call-function as-transaction two-way-hook.testnet resume_action json-args '{"request_id":0,"payload":"{\"approved\":true}"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as '<RESPONDER_ACCOUNT>.testnet' network-config testnet sign-with-keychain send
```

For a receiver-level smoke call, only the configured token account is authorized to call `ft_on_transfer`; production verification should use an actual NEP-141 `ft_transfer_call`, which invokes `ft_resolve_transfer` and returns rejected tokens to the sender.

## Testnet trace capture

Record transaction hashes, network, contract/token account IDs, receipt outcome, and raw receipt/log data for both accepted and refunded transfers. Store these provenance-bearing traces as Ticket 05 fixtures. The example contracts do not include or deploy a token contract, so this step requires a separately deployed NEP-141 token and funded Testnet accounts.
