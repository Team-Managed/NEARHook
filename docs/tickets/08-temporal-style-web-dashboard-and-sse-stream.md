# Ticket 08: Temporal-Style Web Dashboard and SSE Live Stream

## Overview
Implement the Next.js developer dashboard in `apps/dashboard` with a real-time Server-Sent Events (SSE) live stream, an interactive Temporal-style DAG visualizer, and a granular settlement details inspector.

## Requirements
1. Backend Live Stream Route:
   - `GET /api/events/live-stream`: Server-Sent Events (SSE) endpoint emitting graph deltas (`node_added`, `edge_added`, `settlement_complete`, `delivery_success`).
2. Interactive DAG Canvas:
   - Renders vertices with color-coded execution states:
     - Green: `SuccessValue` (`CONFIRMED`)
     - Red: `ActionError` (Panic / Unhandled Failure)
     - Orange: `REFUNDED` (Full resolver return)
     - Purple: `PARTIALLY_REFUNDED` (Split order fulfillment) (ADR-009)
     - Yellow: `YIELDED` (Two-Way Webhook paused on-chain awaiting off-chain HTTP approval) (ADR-004)
   - Visualizes promise spawns and callback dependency edges across shards.
3. Diagnostic Inspector & 1-Click Replay:
   - Side drawer inspecting `settlement.details`: shows panicked receipt ID, panic reason, raw return bytes, and gas burnt without opening a block explorer (ADR-009).
   - Form to create/edit subscriptions (with `agent_safe: true` toggle).
   - Button to trigger instant free replay from historical PostgreSQL JSONB logs.

## Test Seams & Acceptance Criteria
- Component & API tests:
  1. SSE endpoint pushes event updates correctly.
  2. Canvas renders multi-hop graph accurately including `YIELDED` and `PARTIALLY_REFUNDED` states.
  3. Diagnostic drawer renders panic reasons and raw return bytes from `settlement.details`.
  4. Replay button sends request to `/api/replay` and triggers delivery.

