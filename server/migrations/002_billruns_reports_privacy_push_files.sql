-- Bill runs: accounts prepares a month's bills, the committee approves, and
-- only then are bills issued and residents told.
CREATE TABLE bill_runs (
  id serial PRIMARY KEY,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'rejected')),
  rate numeric(8, 2) NOT NULL,
  issued_on date NOT NULL,
  due_on date NOT NULL,
  flat_count integer NOT NULL,
  total integer NOT NULL,
  prepared_by integer NOT NULL REFERENCES users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz,
  note text,
  CHECK (decided_by IS NULL OR decided_by <> prepared_by)
);
CREATE UNIQUE INDEX bill_runs_one_open ON bill_runs (period) WHERE status IN ('draft', 'issued');
ALTER TABLE bills ADD CONSTRAINT bills_run_fk FOREIGN KEY (bill_run_id) REFERENCES bill_runs(id);

-- Signed monthly reports: a frozen copy of the figures the committee approved.
CREATE TABLE report_signoffs (
  id serial PRIMARY KEY,
  period text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  sha256 text NOT NULL,
  signed_by integer NOT NULL REFERENCES users(id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  note text
);
CREATE TRIGGER report_signoffs_append_only BEFORE UPDATE OR DELETE ON report_signoffs FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- DPDP Act 2023: requests from residents to correct or erase their data.
CREATE TABLE data_requests (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('correction', 'erasure')),
  details text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_by integer REFERENCES users(id),
  handled_at timestamptz,
  response text
);

-- Web push subscriptions, one per browser.
CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

-- Photos live in object storage; rows keep only the key.
CREATE TABLE files (
  key text PRIMARY KEY,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('complaint', 'visitor')),
  flat_id text REFERENCES flats(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
ALTER TABLE complaints ADD COLUMN photo_key text REFERENCES files(key) ON DELETE SET NULL;
ALTER TABLE visitors ADD COLUMN photo_key text REFERENCES files(key) ON DELETE SET NULL;

-- Push messages carry a link to open when tapped.
ALTER TABLE messages ADD COLUMN data jsonb;
