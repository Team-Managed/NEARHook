CREATE TABLE IF NOT EXISTS checkpoints (
  network TEXT PRIMARY KEY CHECK (network IN ('mainnet', 'testnet')),
  last_block_height BIGINT NOT NULL CHECK (last_block_height >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT ARRAY['settlement']::TEXT[],
  destination_url TEXT NOT NULL,
  agent_safe BOOLEAN NOT NULL DEFAULT FALSE,
  dust_threshold_usd NUMERIC(10, 4) NOT NULL DEFAULT 1.0000,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'PAUSED_MANUAL', 'PAUSED_UNHEALTHY')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_account
  ON subscriptions (status, account_id);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tx_hash TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  protocol_status TEXT NOT NULL,
  business_status TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED')),
  http_status SMALLINT,
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  latency_ms INTEGER,
  response_body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deliveries_tx_hash ON deliveries (tx_hash);
CREATE INDEX IF NOT EXISTS idx_deliveries_subscription_created
  ON deliveries (subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS terminal_dags (
  tx_hash TEXT PRIMARY KEY,
  block_height BIGINT NOT NULL,
  dag JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS two_way_yields (
  yield_token TEXT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AWAITING_WEBHOOK'
    CHECK (status IN ('AWAITING_WEBHOOK', 'RESUMING', 'RESUMED', 'EXPIRED')),
  resume_payload TEXT,
  resume_tx_hash TEXT,
  created_at_block BIGINT NOT NULL,
  expires_at_block BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_two_way_yields_status ON two_way_yields (status);
CREATE INDEX IF NOT EXISTS idx_two_way_yields_contract ON two_way_yields (contract_id);
