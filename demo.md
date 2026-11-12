# NearHook: Two-Minute Demo Plan

## Demo goal

Show three connected ideas in a split screen:

1. A webhook arrives through the local tunnel and appears in a live dashboard.
2. Agent-Safe mode keeps hostile transaction metadata out of prompt-facing fields.
3. A NEAR contract pauses on a yield and resumes after its authorized responder approves.

## Readiness

The CLI tunnel, terminal receipt-tree view, Agent-Safe sanitizer, and two-way hook contract are implemented. The browser dashboard is still pending in [Ticket 08](docs/tickets/08-temporal-style-web-dashboard-and-sse-stream.md), and the automatic yield responder is not connected. Until the dashboard is implemented, use the CLI's ASCII receipt view as the live visual; do not present it as a working browser dashboard.

## Setup before recording

- Keep the browser dashboard on the right and two terminal panes on the left: `nearhook listen` and NEAR calls.
- Run `nearhook listen` with `--agent-safe` and forward to the local webhook receiver shown in the dashboard.
- For the two-way hook, deploy the contract account and configure a separate responder account. The owner may be the responder, but the responder must differ from the contract account.
- Prepare a valid event with a hostile memo that clears the dust threshold; Agent-Safe should quarantine the memo. Prepare a pending yield with request ID `0`.

## Two-minute sequence

### 0:00–0:25 — Tunnel and live event

Show the listener connected and the browser dashboard waiting for events. Trigger the prepared transaction. Point to the webhook arriving at localhost and the corresponding dashboard update.

Say: “NearHook forwards the event through a local tunnel, so the service can receive it without exposing a development server.”

### 0:25–0:55 — Untrusted metadata stays quarantined

Show the hostile memo under `untrusted_metadata`, with sender, amount, and other trusted fields separated. Show that prompt-facing fields contain no instruction from the memo. If the event is below the configured value threshold, show that Agent-Safe drops it before forwarding.

Say: “Transaction text is external input. Agent-Safe isolates it from the fields an agent should use to make decisions.”

### 0:55–1:25 — Pause on-chain work

In the terminal, call `request_action` on the two-way hook. Show the `yield_created` event and the pending state in the dashboard.

```sh
near contract call-function as-transaction <HOOK_CONTRACT>.testnet request_action json-args '{"action_id":"demo-approval-1"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <REQUESTER>.testnet network-config testnet sign-with-keychain send
```

Say: “The contract has yielded while approval is pending.”

### 1:25–1:50 — Resume through the responder

Call `resume_action` from the configured responder account using request ID `0`:

```sh
near contract call-function as-transaction <HOOK_CONTRACT>.testnet resume_action json-args '{"request_id":0,"payload":"{\"approved\":true}"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <RESPONDER>.testnet network-config testnet sign-with-keychain send
```

Show the successful transaction and the dashboard state moving from pending to resumed.

### 1:50–2:00 — Close

Say: “NearHook brings local webhook delivery, agent-safe event handling, and resumable NEAR execution into one developer workflow.”

## Current limitation

This storyboard depends on the browser dashboard and its live event feed, which are not implemented yet. The current CLI can show the receipt tree in the terminal. The contract can be resumed with a manual `resume_action` call; an automated gateway responder is future work.
