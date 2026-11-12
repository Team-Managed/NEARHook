# NearHook: UI & Canvas Design Context

## 1. Aesthetic & Brand Identity (Brand Inspo: ArkLink Matrix & Editorial Serif)
- **High-Density Cryptographic & Editorial Aesthetic:**
  - Technical, terminal-native precision paired with high-end editorial typography.
  - Dark matrix background with ASCII/glyph grid cells (`>`, `<`, `!`, `*`, `+`, `?`, and hex matrix coordinates).
  - Elegant editorial serif headlines (e.g., *Newsreader*, *Instrument Serif*, *Editorial New*, or *Georgia*) contrasted with crisp monospace data and sans-serif functional UI controls.

- **Brand Color Palette (Sampled from Brand Inspo):**
  - **Base Canvas (Dark Charcoal / Slate):**
    - Primary Canvas: `#1E2022` (Deep Charcoal Slate)
    - Dark Contrast / Deep Abyss: `#040405` / `#121213`
    - Card Surfaces & Panels: `#24272A` / `#2F3336`
    - Borders & Cell Dividers: `#2D2F30` / `#363B3E`
  - **Spruce & Sage Greens (Depth, Submerged Layers & Positive State):**
    - Deep Spruce / Pine Green: `#345E50` (Primary brand accent & depth layer)
    - Mid Forest / Sage: `#56796E` / `#648377`
    - Soft Sage / Seafoam: `#79958C` / `#9CB1AB`
    - Pale Mint / Mineral Off-White: `#CDD8D6` / `#DAE0DD`
  - **Signal / Accent (Tangerine Orange):**
    - Caught Hop / Action Highlight: `#F28C28` (High-contrast signal for caught transactions, warnings, and focused hops)
  - **Warm Stone & Minerals (Muted Accents & Secondary Labels):**
    - Warm Stone: `#9A958A` / `#B0ACA2` / `#BDB9B1`
  - **Typography & Text Colors:**
    - High-Contrast Body & Headers: `#F2F0EB` / `#EBEBE7` (Bone Off-White)
    - Muted Secondary Text: `#848584` / `#9CB1AB`
    - Monospace Glyphs / Matrix Streams: `#CDD8D6` on `#345E50` or `#1E2022`

- **Status & Settlement Indicators:**
  - `CONFIRMED` / `SuccessValue`: `#56796E` / `#79958C` (Sage & Spruce Green)
  - `REFUNDED` / Caught Hop: `#F28C28` (Vibrant Mandarin Orange)
  - `PARTIALLY_REFUNDED`: `#9A958A` (Warm Stone / Amber-Slate)
  - `YIELDED` (Two-Way Webhook Pause): `#D8A25E` (Warm Mineral Amber)
  - `FAILURE` / `ActionError`: `#C94A4A` (Muted Crimson)

## 2. Interactive DAG Canvas (`apps/dashboard` & Client-Facing Website)
- **Visual Matrix Canvas:**
  - Graph representation of asynchronous receipt trees rendered over a subtle monospace matrix or ASCII glyph grid.
  - Multi-hop receipt streams converging and diverging like braided signal waves (visualizing Nightshade cross-shard execution).
  - Vertices: Receipt outcomes showing predecessor, receiver, method name, execution status, and gas burnt.
  - Edges: Directed arrows for child promise spawns and callback dependencies.
  - Real-time updates via Server-Sent Events (SSE).
  - Side drawer displaying structured `settlement.details` (panic reasons, raw return bytes, panicked receipt ID).

## 3. Terminal TUI (`packages/cli`)
- Interactive ASCII DAG visualizer printed in `stdout` for `nearhook listen`.
- Uses Unicode box drawing characters (`┌`, `├`, `│`, `└`, `─`) with ANSI 256-color accents mapped to Spruce Green (`#345E50`) and Tangerine Orange (`#F28C28`).

