# Ticket 06: Developer CLI Tunnel Listener (`nearhook listen`)

**Status:** In Progress  
**Monorepo Package:** `packages/cli`  
**Dependencies:** `@nearhook/core` (workspace), `commander`, `ws`, `@types/ws`  

---

## 1. Overview & Problem Solved

Developers building decentralized applications, merchants settling payments, and engineers building autonomous AI agents on NEAR Protocol need to test webhooks locally on `http://localhost:PORT`. 

Historically, developers were forced to rely on generic tunneling tools like ngrok, which introduce:
1. External account sign-up and rate limits.
2. Inability to parse NEAR's multi-block asynchronous receipt trees.
3. Lack of agent safety (local AI agents remain exposed to prompt injection attacks and dust flooding).
4. No visibility into cross-shard receipt propagation or gas refund pruning.

`@nearhook/cli` solves this with a zero-config local tunneling command:
```bash
npx nearhook listen --account "merchant.testnet" --forward "http://localhost:3000/api/webhook"
```

---

## 2. Requirements & Architecture

### 2.1 CLI Interface & Flags
Command: `nearhook listen --account <pattern> --forward <local_url> [options]`

Flags:
- `--account <pattern>` (required): Account matching pattern (e.g. `merchant.testnet`, `*.near`, `agent-*.app.near`).
- `--forward <url>` (required): Local webhook destination URL (e.g. `http://localhost:3000/api/webhook`).
- `--standalone` (optional): Bypasses the hosted gateway; polls FastNEAR directly, stitches DAGs in-process with `@nearhook/core`, and forwards to `localhost:PORT` with zero server dependencies.
- `--agent-safe` (optional): Intercepts events and sanitizes memos / drops dust (< \$1.00 USD) locally before forwarding to AI agents.
- `--hub <url>` (optional): Custom Tunnel Hub WebSocket URL (defaults to `NEARHOOK_HUB_URL` or `wss://gateway.nearhook.dev/tunnel`).
- `--secret <token>` (optional): Shared client token for authenticated private relay sessions.

---

### 2.2 Hybrid Operation Modes (ADR-008)

```text
                                  ┌────────────────────────────────────────┐
                                  │       NEARHOOK TUNNEL HUB RELAY        │
                                  │  (wss://gateway.nearhook.dev/tunnel)   │
                                  └───────────────────┬────────────────────┘
                                                      │ WebSocket Push
                                                      ▼
┌───────────────────────┐         ┌────────────────────────────────────────┐
│  FASTNEAR BLOCK API   │ ──────► │          @nearhook/cli listen          │
│ (api.fastnear.com/v0) │         │  • Hybrid Mode (Relay vs Standalone)   │
└───────────────────────┘         │  • Agent-Safe Filter (--agent-safe)    │
     [Standalone Mode]            │  • Interactive ASCII Receipt DAG TUI   │
                                  │  • HTTP Forwarder (latency/status)     │
                                  └───────────────────┬────────────────────┘
                                                      │ HTTP POST
                                                      ▼
                                  ┌────────────────────────────────────────┐
                                  │         DEVELOPER LOCAL SERVER         │
                                  │      (http://localhost:3000/...)       │
                                  └────────────────────────────────────────┘
```

#### Mode 1: Hosted Tunnel Relay (Default)
- Connects outbound via persistent WebSocket (`ws`) to NearHook's Tunnel Hub (`${hubUrl}?account=${encodeURIComponent(account)}`).
- **Handshake & Protocol:**
  - Client sends `{ type: "subscribe", account: pattern, agent_safe: boolean }`.
  - Hub sends `{ type: "ping" }` $\leftrightarrow$ Client responds `{ type: "pong" }` (30s keepalive).
  - Hub pushes `{ type: "event", payload: CanonicalWebhookPayload }`.
  - Client ACKs after successful dispatch: `{ type: "ack", event_id: payload.id }`.
- **Resilient Auto-Reconnect:** Exponential backoff with jitter (initial: 1s, factor: 2.0x, max: 30s). Reconnects seamlessly on disconnects without crashing.

#### Mode 2: Standalone Mode (`--standalone`)
- Operates with **zero cloud dependencies**; ideal for offline development, local debugging, or air-gapped CI.
- Polls FastNEAR public REST endpoint (`https://api.fastnear.com/v0/last_block/optimistic` and `/v0/block_opt/{height}`).
- Extracts chunk execution outcomes matching `--account`.
- Ingests outcomes into the in-process `@nearhook/core` DAG stitcher (`processReceiptOutcome`).
- When $\Delta(T) = \emptyset$ and root is registered, invokes `evaluateSettlement()` and produces a `CanonicalWebhookPayload` directly in the CLI process.

---

### 2.3 Dual-Level Agent-Safe Filtering (`--agent-safe`) (ADR-005, ADR-012)
When the developer specifies `--agent-safe`:
1. The payload passes through `sanitizeForAgent(payload)` from `@nearhook/core`.
2. **Dust Sieve (Denial-of-Wallet Defense):** Evaluates transfer USD value against the \$1.00 minimum threshold. If the transfer is dust (< \$1.00 USD), the function returns `null`. The CLI logs:
   ```text
   [nearhook] 🛡️  Agent-Safe: Dropped dust event evt_01J... (< $1.00 USD threshold).
   ```
   and aborts forwarding, preserving the local agent's inference budget.
3. **Prompt Injection Quarantine:** Free-form memos, logs, and panic reasons are stripped from prompt-facing fields and quarantined in `untrusted_metadata`.
4. If `--agent-safe` is omitted, the CLI forwards the raw `CanonicalWebhookPayload` unquarantined.

---

### 2.4 Local HTTP Forwarder
- Forwards incoming events via HTTP POST to the `--forward` destination URL using native `fetch`.
- Headers attached:
  - `Content-Type: application/json`
  - `X-NearHook-Id: <id>`
  - `X-NearHook-Timestamp: <timestamp>`
  - `X-NearHook-Signature: <signature>`
  - `X-NearHook-Delivery-Attempt: <attempt_number>`
- Records execution latency in milliseconds and logs HTTP status (e.g. `200 OK (34ms)`).

---

### 2.5 Interactive Terminal TUI (ASCII DAG Visualizer) (ADR-008)
Renders a live ASCII receipt tree in `stdout`, showing shard hops, receipt statuses, gas pruning savings (~600ms), and final settlement:

```text
┌─ NEARHOOK EVENT [evt_01JBMX92...] ─────────────────────────────────
│ Tx: 7gQ3...9kLp  •  Block: 124,892,104  •  Shards: Shard 0 ➔ Shard 1
├─ RECEIPT TREE
│  ├── [Shard 0] merchant.near::ft_transfer_call ─────── ✔ SUCCESS (1.2 Tgas)
│  │   ├── [Shard 1] store.near::ft_on_transfer ──────── ✘ PANIC: "Inventory Empty"
│  │   └── [Shard 0] merchant.near::ft_resolve_transfer ── ✔ REFUND 100% (0.4 Tgas)
│  └── ✂ [Gas Refund] system ➔ merchant.near ───────────── [PRUNED -600ms latency win]
├─ SETTLEMENT
│  • Protocol Status: SUCCESS
│  • Business Status: REFUNDED (100% tokens returned to sender)
│  • Omnichain Route: 100.00 USDC (intents.near ➔ mock-store.testnet)
├─ LOCAL DISPATCH
│  ➔ POST http://localhost:3000/api/webhook ── 200 OK (38ms)
└────────────────────────────────────────────────────────────────────
```

Colors (ANSI escape sequences):
- Spruce Green (`#345E50` / `\x1b[32m`) for successful receipt executions.
- Mandarin Orange (`#F28C28` / `\x1b[33m`) for business refunds and pruned gas hops.
- Muted Crimson (`\x1b[31m`) for unhandled panics and errors.
- Bone White (`\x1b[37m`) for structural borders and headers.

---

## 3. Package Structure (`packages/cli`)

```text
packages/cli/
├── package.json          # @nearhook/cli, bin: { "nearhook": "./dist/bin/nearhook.js" }
├── tsconfig.json         # extends tsconfig.base.json
├── src/
│   ├── bin/
│   │   └── nearhook.ts   # Entry point configuring commander program & subcommands
│   ├── commands/
│   │   └── listen.ts     # Action handler for `nearhook listen`
│   ├── tunnel/
│   │   ├── client.ts     # WebSocket tunnel client (auto-reconnect, ping/pong, ack)
│   │   └── standalone.ts # Direct FastNEAR poller + in-process DAG stitcher for --standalone
│   ├── forwarder/
│   │   └── http.ts       # Local HTTP POST forwarder with timing/latency recording
│   ├── tui/
│   │   └── tree.ts       # Pure ASCII DAG tree visualizer (Spruce Green / Mandarin Orange ANSI)
│   └── index.ts          # Programmatic API exports
└── test/
    ├── listen.test.ts    # Comprehensive test suite covering all 4 acceptance criteria
    └── tree.test.ts      # ASCII TUI rendering tests for single & multi-shard DAGs
```

---

## 4. Test Seams & Acceptance Criteria

Unit tests in `packages/cli/test/listen.test.ts` and `tree.test.ts`:
1. **Flag Parsing:** CLI parses command flags accurately (including `--standalone`, `--agent-safe`, `--account`, `--forward`, `--hub`). Missing required flags exit with clear errors.
2. **Local HTTP Forwarding:** Mocks a local HTTP server with `node:http`, forwards received payloads, and asserts headers (`X-NearHook-*`) and body.
3. **Agent-Safe Local Interception:** Dispatches an event with an attacker memo and dust amount; verifies dust is dropped and untrusted strings quarantined in `--agent-safe` mode.
4. **WebSocket Reconnection:** Drops a mock WebSocket server connection and verifies client reconnects with exponential backoff.
5. **Interactive ASCII TUI:** Formats ASCII TUI tree accurately for single-shard, multi-shard, and pruned gas refund DAGs without ANSI corruptions or runtime crashes.
