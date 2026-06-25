CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TYPE app.service_tier AS ENUM ('Starter', 'Growth', 'Premium');
CREATE TYPE app.integration_provider AS ENUM ('google', 'microsoft');
CREATE TYPE app.task_status AS ENUM ('pending', 'processing', 'needs_review', 'approved', 'completed', 'failed');

CREATE OR REPLACE FUNCTION app.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_client_id', true), '')::uuid
$$;

CREATE TABLE app.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name text NOT NULL,
  service_tier app.service_tier NOT NULL,
  monthly_retainer_hours numeric(6,2) NOT NULL CHECK (monthly_retainer_hours >= 0),
  sop_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(id) ON DELETE CASCADE,
  provider app.integration_provider NOT NULL,
  encrypted_access_token text NOT NULL CHECK (length(encrypted_access_token) > 0),
  encrypted_refresh_token text NOT NULL CHECK (length(encrypted_refresh_token) > 0),
  token_encryption_key_id text NOT NULL,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider)
);

CREATE TABLE app.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  status app.task_status NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  failure_log jsonb,
  delivery_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_credentials_client_id_idx ON app.integration_credentials (client_id);
CREATE INDEX tasks_client_id_status_idx ON app.tasks (client_id, status);
CREATE INDEX tasks_client_id_created_at_idx ON app.tasks (client_id, created_at);

ALTER TABLE app.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clients FORCE ROW LEVEL SECURITY;

ALTER TABLE app.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_credentials FORCE ROW LEVEL SECURITY;

ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY clients_select_by_verified_client
  ON app.clients
  FOR SELECT
  USING (id = app.current_client_id());

CREATE POLICY clients_insert_by_verified_client
  ON app.clients
  FOR INSERT
  WITH CHECK (id = app.current_client_id());

CREATE POLICY clients_update_by_verified_client
  ON app.clients
  FOR UPDATE
  USING (id = app.current_client_id())
  WITH CHECK (id = app.current_client_id());

CREATE POLICY integration_credentials_select_by_verified_client
  ON app.integration_credentials
  FOR SELECT
  USING (client_id = app.current_client_id());

CREATE POLICY integration_credentials_insert_by_verified_client
  ON app.integration_credentials
  FOR INSERT
  WITH CHECK (client_id = app.current_client_id());

CREATE POLICY integration_credentials_update_by_verified_client
  ON app.integration_credentials
  FOR UPDATE
  USING (client_id = app.current_client_id())
  WITH CHECK (client_id = app.current_client_id());

CREATE POLICY tasks_select_by_verified_client
  ON app.tasks
  FOR SELECT
  USING (client_id = app.current_client_id());

CREATE POLICY tasks_insert_by_verified_client
  ON app.tasks
  FOR INSERT
  WITH CHECK (client_id = app.current_client_id());

CREATE POLICY tasks_update_by_verified_client
  ON app.tasks
  FOR UPDATE
  USING (client_id = app.current_client_id())
  WITH CHECK (client_id = app.current_client_id());

COMMENT ON FUNCTION app.current_client_id() IS
  'Returns the verified tenant id set by the application session after authentication token verification.';

COMMENT ON COLUMN app.integration_credentials.encrypted_access_token IS
  'Encrypted OAuth access token ciphertext only; never store plaintext tokens in this column.';

COMMENT ON COLUMN app.integration_credentials.encrypted_refresh_token IS
  'Encrypted OAuth refresh token ciphertext only; never store plaintext tokens in this column.';

COMMENT ON COLUMN app.clients.sop_rules IS
  'Client-specific SOP rules loaded dynamically per task execution; never share across tenant contexts.';

COMMENT ON COLUMN app.tasks.failure_log IS
  'Structured queue failure details for operational review; do not store secrets or plaintext OAuth tokens.';

COMMENT ON COLUMN app.tasks.delivery_log IS
  'Structured production delivery receipts such as third-party message or transaction IDs.';
