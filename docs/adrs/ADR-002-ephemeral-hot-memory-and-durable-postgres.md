# ADR-002: Two-Tier Storage Model (Ephemeral Redis + Durable PostgreSQL)

## Status
Accepted

## Context
A NEAR transaction decomposes into cross-shard receipts executing across 2 to 4+ blocks (~2–5 seconds).
During this execution window, receipt outcomes arrive asynchronously and possibly out of order.
Storing the entire blockchain or indexing raw receipts in a relational database introduces high write amplification and database bloat. Conversely, using only in-memory storage loses delivery history and subscription rules across service restarts.

## Decision
We implement a two-tier storage architecture modeled after industry standards (Helius, Svix):

1. **Hot Ephemeral Store (Redis, 60s TTL):**
   - Stores in-flight receipts for active transactions:
     - `nearhook:tx:{hash}:spawned` (Set of spawned receipt IDs)
     - `nearhook:tx:{hash}:executed` (Set of executed receipt IDs)
     - `nearhook:tx:{hash}:nodes` (Hash of receipt execution outcomes)
     - `nearhook:tx:{hash}:edges` (List of parent-child dependencies)
   - Evaluates the completeness invariant atomically:
     `SDIFF nearhook:tx:{hash}:spawned nearhook:tx:{hash}:executed`
   - Keys automatically expire after 60 seconds, keeping hot memory footprint $<50\text{MB}$.

2. **Durable Store (PostgreSQL / NeonDB):**
   - Persists long-lived configuration and delivery history:
     - `subscriptions`: User wildcard rules (`*.near`, `intents.near`), chain filters (`SOLANA`, `BITCOIN`), endpoint URLs.
     - `deliveries`: Stitched canonical JSON payloads (`payload` JSONB column), HTTP delivery status codes, latency measurements, and retry counts.
     - Circuit breaker state (`ACTIVE`, `PAUSED_UNHEALTHY`).

## Consequences
- **Positive:**
  - High-throughput atomic set operations in Redis resolve DAGs in $<2\text{ms}$.
  - Relational database only receives finalized, matched events, minimizing disk I/O.
  - Durable `JSONB` column enables 1-click historical replay for developers without paying on-chain gas.
- **Negative:**
  - Requires maintaining both Redis and PostgreSQL connections in the ingestion service.

