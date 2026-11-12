# Ticket 10: NearHook Agent Skill Integration (`near/agent-skills`)

## Overview
Package NearHook as an official, self-contained AI Agent Skill conforming to the NEAR Foundation's `near/agent-skills` specification (`npx skills add nearhook`). 

While existing NEAR agent skills focus purely on **outbound** blockchain transactions (`near-cli-rs`, `near-api-js`, `near-intents`), NearHook provides the critical **inbound event delivery, settlement verification, and prompt-injection firewall layer** that autonomous AI agents need to operate safely.

## Requirements

1. **Agent Skill Manifest & Documentation (`skills/nearhook/SKILL.md`):**
   - YAML frontmatter with standardized metadata:
     - `name`: `nearhook`
     - `description`: Settlement-aware webhook gateway, prompt injection quarantine shield, and two-way execution pause/resume for NEAR Protocol and omnichain clearinghouses.
   - Comprehensive agent guidance:
     - How an autonomous agent registers subscriptions to monitor watched smart contracts.
     - How to start local tunneling with prompt-injection defense (`nearhook listen --agent-safe --forward <local_endpoint>`).
     - How to verify Ed25519 webhook signatures with pinned keys before triggering agent workflows.
     - How to handle dual-axis settlement (`protocol_status` vs `business_status`).

2. **Autonomous AI Agent Safety Directives:**
   - Explicit instructions forbidding agents from injecting raw memos from `untrusted_metadata.memo` into LLM prompts.
   - Prescribes the use of structured typed fields (`amount`, `token`, `sender`, `recipient`, `settlement.business_status`) for agent decision-making.
   - Guidance on the \$1.00 USD minimum value sieve to protect agent LLM token budgets against dust attacks.

3. **Two-Way Execution Resume Action (`yield_create` / `yield_resume`):**
   - Documentation and code patterns for how an AI agent (e.g., Risk Officer or KYC Agent) inspects an incoming paused transaction and unfreezes the on-chain contract with an approval or rejection response.

4. **Framework Integration Examples:**
   - ElizaOS Plugin / Action definition.
   - LangChain.js Webhook Tool definition.
   - Native Node.js / Next.js route handler with `@nearhook/core` verification.

## Acceptance Criteria
- Valid `SKILL.md` adhering to the Agent Skills standard, ready for submission to `near/agent-skills`.
- Complete developer and autonomous agent instructions for replaying provenance-bearing receipt fixtures (`nearhook trigger --fixture <path>`), clearly marked as test data.
- Zero unverified assumptions: all code snippets strictly use the verified `@nearhook/core` API.

