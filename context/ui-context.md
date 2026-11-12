# NearHook: UI & Canvas Design Context

## 1. Aesthetic & Design Philosophy
- **Developer-First Aesthetic:** Clean, high-contrast, dark-mode-first developer tool inspired by Stripe, Temporal, and Datadog.
- **Color Palette:**
  - Background: `#0B0F17` (Obsidian Slate)
  - Cards & Sidebars: `#111827` (Deep Neutral)
  - Primary Accent (NEAR Green): `#00EC97`
  - Secondary Accent (Purple): `#9945FF`
  - Borders: `#1F2937`
  - Status Indicators:
    - `CONFIRMED` / `SuccessValue`: `#00EC97` (Green)
    - `REFUNDED`: `#F59E0B` (Amber / Orange)
    - `PARTIALLY_REFUNDED`: `#9945FF` (Purple)
    - `YIELDED` (Two-Way Pause): `#EAB308` (Yellow)
    - `FAILURE` / `ActionError`: `#F43F5E` (Rose / Red)

## 2. Interactive DAG Canvas (`apps/dashboard`)
- Graph representation of asynchronous receipt trees.
- Vertices: Receipt outcomes showing predecessor, receiver, method name, and gas burnt.
- Edges: Directed arrows for child promise spawns and callback dependencies.
- Real-time updates via Server-Sent Events (SSE).
- Side drawer displaying structured `settlement.details` (panic reasons, raw return bytes, panicked receipt ID).

## 3. Terminal TUI (`packages/cli`)
- Interactive ASCII DAG visualizer printed in `stdout` for `nearhook listen`.
- Uses Unicode box drawing characters (`┌`, `├`, `│`, `└`, `─`) with ANSI 256-color accents.

