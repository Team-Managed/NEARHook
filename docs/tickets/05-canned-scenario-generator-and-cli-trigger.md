# Ticket 05: Canned Scenario Generator and CLI Trigger Driver

## Overview
Implement the canned scenario generator and the `nearhook trigger` command in `@nearhook/cli`, allowing developers and CI bots to test real-world settlement scenarios instantly with zero network dependencies.

## Requirements
1. `packages/cli/src/fixtures/scenarios.ts`:
   - `payment.succeeded`: 2-block confirmation with successful transfer.
   - `payment.refunded`: 3-block sequence with `ft_on_transfer` panic and `ft_resolve_transfer` refund.
   - `intent.settled`: DIP-4 multi-token swap on `intents.near`.
2. `packages/cli/src/commands/trigger.ts`:
   - Command: `nearhook trigger <scenario-name> [--forward <url>]`
   - Executes the real `@nearhook/core` DAG engine in-process with the scenario's receipt outcomes.
   - Signs the resulting payload with a test Ed25519 relayer key.
   - If `--forward` is supplied, issues an HTTP POST to the local endpoint; otherwise prints formatted JSON output to stdout.

## Test Seams & Acceptance Criteria
- Unit tests in `packages/cli/test/trigger.test.ts`:
  1. `nearhook trigger payment.refunded` outputs `business_status: "REFUNDED"`.
  2. `nearhook trigger payment.succeeded` outputs `business_status: "CONFIRMED"`.
  3. When an endpoint is supplied, dispatches HTTP POST and receives 200 OK.
  4. Command exits cleanly with code 0.

