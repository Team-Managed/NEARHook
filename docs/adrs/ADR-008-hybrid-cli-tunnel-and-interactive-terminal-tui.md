# ADR-008: Hybrid Developer CLI Tunnel Architecture and Interactive Terminal TUI

## Status
Accepted

## Context
Developers and AI agent builders need to receive webhooks locally at `http://localhost:PORT`. 
1. **Relay-Only Drawback:** If the CLI strictly requires a hosted WebSocket relay server, developers cannot test offline, in air-gapped CI environments, or during gateway maintenance.
2. **Standalone-Only Drawback:** If the CLI only polls the blockchain directly, it cannot support multiplexed team tunnels or cloud-coordinated sessions.
3. **Developer Experience:** Web-only dashboards force terminal-centric developers and automated runners to switch context to a browser to observe DAG execution.

## Decision
1. **Hybrid Tunnel Mode (`nearhook listen`):**
   - **Default Mode (Hosted Relay):** Connects to the NearHook WebSocket relay (`wss://gateway.nearhook.dev/tunnel/{account}`) for cloud-backed delivery and team routing.
   - **Standalone Mode (`--standalone`):** Connects directly to FastNEAR Neardata REST/WebSocket APIs, executes the `@nearhook/core` DAG stitcher in-process, and delivers events directly to `localhost:PORT` with **zero cloud server dependencies**.
2. **Interactive Terminal TUI (ASCII DAG Visualizer):**
   - The CLI renders a real-time reactive ASCII tree directly in `stdout` as receipts arrive, light up green, and prune gas refunds, matching the visual fidelity of the web dashboard inside the developer's terminal.

## Consequences
- **Positive:** Maximum operational resilience: developers can run end-to-end local tunnels even if the hosted gateway is down.
- **Positive:** Terminal-first workflow with high-impact visual feedback during live hackathon demos.
- **Negative:** CLI package includes light local poller logic from `@nearhook/core` alongside the WebSocket tunnel client.

