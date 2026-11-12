# Ticket 06: Developer CLI Tunnel Listener (`nearhook listen`)

## Overview
Implement the zero-config local tunneling client in `@nearhook/cli`, connecting developers' local machines (`localhost:PORT`) to NearHook's event stream without ngrok.

## Requirements
1. `packages/cli/src/commands/listen.ts`:
   - Command: `nearhook listen --account <pattern> --forward <local_url> [--standalone] [--agent-safe]`
   - **Hybrid Mode (ADR-008):**
     - Default: Connects outbound via persistent WebSocket to NearHook's Tunnel Hub (`wss://gateway.nearhook.dev/tunnel` or local hub).
     - `--standalone`: Bypasses the hosted gateway; polls FastNEAR directly, stitches DAGs in-process with `@nearhook/core`, and forwards to `localhost:PORT` with zero server dependencies.
   - **Local Agent-Safe Filter (ADR-012):**
     - `--agent-safe`: Intercepts events and sanitizes memos / drops dust locally before forwarding to AI agents.
2. Interactive Terminal TUI (ADR-008):
   - Renders a live ASCII receipt tree in `stdout`, showing shard hops, receipt statuses, gas pruning savings (~600ms), and final settlement.
3. Local HTTP Forwarder:
   - Forwards incoming events via HTTP POST to the `--forward` destination.
   - Logs timestamp, event ID, HTTP status code, and latency in formatted terminal output.

## Test Seams & Acceptance Criteria
- Unit tests in `packages/cli/test/listen.test.ts`:
  1. CLI parses command flags accurately (including `--standalone` and `--agent-safe`).
  2. Forwards received payloads to local mock HTTP server.
  3. Reconnects on connection drops with exponential backoff.
  4. Formats ASCII TUI tree accurately for multi-shard DAGs.

