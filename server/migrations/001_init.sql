-- Township schema. Money is held in whole rupees (integer); dates are
-- calendar dates in IST; timestamps are timestamptz.

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE flats (
  id text PRIMARY KEY CHECK (id ~ '^T[0-9]{2}-[0-9]{4}$'),
  tower text NOT NULL,
  area integer NOT NULL CHECK (area > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^[6-9][0-9]{9}$'),
  role text NOT NULL CHECK (role IN ('resident', 'helpdesk', 'accounts', 'committee', 'guard', 'admin')),
  flat_id text REFERENCES flats(id),
  relation text CHECK (relation IN ('owner', 'tenant', 'family')),
  lang text NOT NULL DEFAULT 'en',
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  consent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'resident') = (flat_id IS NOT NULL))
);
CREATE INDEX users_flat ON users (flat_id);

CREATE TABLE upi_handles (
  vpa text PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  learned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Auth -------------------------------------------------------------------
CREATE TABLE otps (
  phone text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0
);
-- One row per OTP request or failed check, for rate limiting by phone and IP.
CREATE TABLE auth_attempts (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  key text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempts_key ON auth_attempts (kind, key, at);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gate text NOT NULL,
  token_hash text UNIQUE,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text
);
CREATE INDEX sessions_user ON sessions (user_id);

-- ---- Money ------------------------------------------------------------------
CREATE TABLE bills (
  id serial PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  area integer NOT NULL,
  rate numeric(8, 2) NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  interest_through date,
  bill_run_id integer,
  UNIQUE (flat_id, period)
);

CREATE TABLE payments (
  id serial PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  amount integer NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('gateway', 'bank', 'opening')),
  reference text,
  utr text,
  gateway_order_id text,
  gateway_payment_id text UNIQUE,
  receipt_no text NOT NULL UNIQUE,
  posted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_flat ON payments (flat_id);
CREATE INDEX payments_utr ON payments (utr);

-- Every rupee that moves for a flat. Balances are always derived from here.
CREATE TABLE ledger (
  id bigserial PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  on_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bill', 'interest', 'payment', 'adjustment', 'opening')),
  description text NOT NULL,
  debit integer NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit integer NOT NULL DEFAULT 0 CHECK (credit >= 0),
  bill_id integer REFERENCES bills(id),
  payment_id integer REFERENCES payments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system'
);
CREATE INDEX ledger_flat ON ledger (flat_id, on_date);

CREATE TABLE receipt_counters (fy text PRIMARY KEY, last integer NOT NULL);

CREATE TABLE payment_orders (
  id text PRIMARY KEY,                -- Razorpay order id
  flat_id text NOT NULL REFERENCES flats(id),
  user_id integer NOT NULL REFERENCES users(id),
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  payment_id integer REFERENCES payments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_imports (
  id serial PRIMARY KEY,
  filename text NOT NULL,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bank_rows (
  id serial PRIMARY KEY,
  import_id integer NOT NULL REFERENCES bank_imports(id),
  txn_date date,
  narration text NOT NULL,
  reference text,
  utr text,
  amount integer NOT NULL,
  status text NOT NULL CHECK (status IN ('posted', 'queue', 'pending_approval', 'resolved', 'duplicate', 'reconciled', 'ignored')),
  flat_id text REFERENCES flats(id),
  score integer NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]',
  candidates jsonb NOT NULL DEFAULT '[]',
  payment_id integer REFERENCES payments(id),
  resolved_by text,
  resolved_at timestamptz
);
CREATE INDEX bank_rows_utr ON bank_rows (utr);
CREATE INDEX bank_rows_status ON bank_rows (status);

-- Maker-checker: manual money actions wait here for a second person.
CREATE TABLE approvals (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('bank_post', 'bank_ignore', 'adjustment')),
  flat_id text REFERENCES flats(id),
  bank_row_id integer REFERENCES bank_rows(id),
  amount integer,
  payload jsonb NOT NULL DEFAULT '{}',
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by integer NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz,
  note text,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX approvals_one_per_row ON approvals (bank_row_id) WHERE status = 'pending';

-- ---- Complaints ---------------------------------------------------------------
CREATE TABLE staff (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text,
  skill text NOT NULL,
  towers text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE complaints (
  id serial PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  raised_by integer REFERENCES users(id),
  text text NOT NULL,
  photo text,
  category text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  ai_category text,
  ai_urgency text,
  ai_confidence real,
  ai_source text,
  category_changed_by text,
  escalated boolean NOT NULL DEFAULT false,
  escalation_reason text,
  status text NOT NULL CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  assignee_id integer REFERENCES staff(id),
  duplicate_of integer REFERENCES complaints(id),
  reopen_count integer NOT NULL DEFAULT 0,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  due_by timestamptz NOT NULL
);
CREATE INDEX complaints_flat ON complaints (flat_id);
CREATE INDEX complaints_status ON complaints (status);
CREATE TABLE complaint_events (
  id bigserial PRIMARY KEY,
  complaint_id integer NOT NULL REFERENCES complaints(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  kind text NOT NULL,
  note text NOT NULL
);
CREATE INDEX complaint_events_c ON complaint_events (complaint_id);

-- ---- Gate ---------------------------------------------------------------------
CREATE TABLE visitors (
  id serial PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  name text NOT NULL,
  purpose text,
  phone text,
  photo text,
  gate text,
  status text NOT NULL CHECK (status IN ('waiting', 'approved', 'denied', 'inside', 'left')),
  guest_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  logged_by integer REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  client_id text UNIQUE
);
CREATE INDEX visitors_flat_day ON visitors (flat_id, created_at);
CREATE TABLE guest_codes (
  code text PRIMARY KEY,
  flat_id text NOT NULL REFERENCES flats(id),
  guest_name text NOT NULL,
  valid_on date NOT NULL,
  used_at timestamptz,
  created_by integer REFERENCES users(id)
);
CREATE TABLE notices (
  id serial PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  posted_on date NOT NULL,
  posted_by integer REFERENCES users(id)
);

-- Every outgoing SMS, push or WhatsApp message and what the provider said.
CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL,
  to_addr text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_ref text,
  error text
);

-- ---- Audit ----------------------------------------------------------------------
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id integer,
  user_name text,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}',
  ip text
);
CREATE INDEX audit_entity ON audit_log (entity, entity_id);

-- The ledger, payments and audit log are append-only: corrections are new
-- entries (adjustments), never edits.
CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
