# ADR-013: Type Architecture: Pure TypeScript Branded Primitives and Boundary Zod Validation

## Status
Accepted

## Context
NearHook processes high-frequency receipt trees while serving as a secure gateway for downstream consumers (Web2 backends and autonomous AI agents):
1. **Internal Performance:** The in-memory DAG state machine processes multiple cross-shard receipts per block. Adding runtime schema validation overhead inside the internal vertex traversal and gas-pruning loops introduces unnecessary CPU latency and memory allocation.
2. **Boundary Security:** Static TypeScript types are erased at compile time. Untrusted external inputs—such as FastNEAR HTTP/WebSocket streams, user webhook responses, and unparsed transaction memos—can contain malformed fields or malicious prompt injections that bypass static types.
3. **Type Duplication Risk:** Manually maintaining separate TypeScript interfaces alongside validation logic inevitably leads to schema drift.

## Decision
NearHook adopts a **Two-Tier Type Architecture**:

1. **Internal Engine Tier (Pure TypeScript & Branded Types):**
   - In-memory graph nodes, vertices, edges, and internal DAG state machine logic use **pure static TypeScript types**.
   - Primitive identifiers use **branded types** to prevent accidental argument transposition at compile time with zero runtime overhead:
     ```typescript
     export type ReceiptId = string & { readonly __brand: unique symbol };
     export type TxHash = string & { readonly __brand: unique symbol };
     ```
2. **Network & AI Safety Boundary Tier (Zod Validation):**
   - External network interfaces (FastNEAR ingestion responses, incoming webhook request bodies, and Agent-Safe sanitizers) are validated at runtime using **Zod**.
   - **Single Source of Truth:** Canonical webhook payload types are inferred directly from their Zod schemas via `z.infer`:
     ```typescript
     export const CanonicalWebhookPayloadSchema = z.object({ ... });
     export type CanonicalWebhookPayload = z.infer<typeof CanonicalWebhookPayloadSchema>;
     ```
   - **Prompt Injection Defense:** The `AgentSafeSanitizer` enforces strict schema parsing (`.strip()`), validating structured fields (`amount`, `token`, `sender`) and isolating free-form strings into `untrusted_metadata.memo` so prompt injection vectors cannot penetrate downstream LLM prompts.

## Consequences
- **Positive:** Maximum execution speed in the internal DAG engine with zero runtime overhead.
- **Positive:** Type safety and runtime protection at external network boundaries with zero schema duplication.
- **Positive:** Compile-time immunity to identifier mix-ups via branded types.
- **Negative:** Adds `zod` as an explicit dependency for `@nearhook/core` (justified by boundary security and AI safety requirements).

