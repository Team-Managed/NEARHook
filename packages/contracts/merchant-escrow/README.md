# Merchant escrow reference contract

NEP-141 `ft_on_transfer` receiver used by Ticket 09. The configured token contract is the only caller accepted. Valid item messages are accepted; `item_out_of_stock`, explicit `simulate_refund`, malformed messages, and calls from other token contracts return the full amount for refund.

See the [contracts guide](../README.md) for build, test, deployment, and call instructions. The demo uses a message flag for deterministic refund coverage; it does not represent production inventory or order logic.
