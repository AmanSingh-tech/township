-- Amenities (clubhouse, courts, ...) and bookings. Fees are charged to the
-- flat's maintenance account, so no separate payment is needed.
CREATE TABLE amenities (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  open_time time NOT NULL DEFAULT '06:00',
  close_time time NOT NULL DEFAULT '22:00',
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 720),
  capacity integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),     -- bookings allowed in the same slot
  fee integer NOT NULL DEFAULT 0 CHECK (fee >= 0),               -- per slot, rupees
  max_slots_per_booking integer NOT NULL DEFAULT 2 CHECK (max_slots_per_booking >= 1),
  max_bookings_per_week integer NOT NULL DEFAULT 3 CHECK (max_bookings_per_week >= 1),
  advance_days integer NOT NULL DEFAULT 14 CHECK (advance_days BETWEEN 0 AND 180),
  cancel_hours integer NOT NULL DEFAULT 24 CHECK (cancel_hours >= 0), -- free cancellation until this many hours before
  rules text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE amenity_blackouts (
  id serial PRIMARY KEY,
  amenity_id integer NOT NULL REFERENCES amenities(id),
  on_date date NOT NULL,
  reason text NOT NULL,
  UNIQUE (amenity_id, on_date)
);
CREATE TABLE bookings (
  id serial PRIMARY KEY,
  amenity_id integer NOT NULL REFERENCES amenities(id),
  flat_id text NOT NULL REFERENCES flats(id),
  user_id integer NOT NULL REFERENCES users(id),
  on_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  slots integer NOT NULL CHECK (slots >= 1),
  fee integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by text,
  refunded boolean NOT NULL DEFAULT false
);
CREATE INDEX bookings_slot ON bookings (amenity_id, on_date) WHERE status = 'confirmed';
CREATE INDEX bookings_flat ON bookings (flat_id, on_date);
ALTER TABLE ledger DROP CONSTRAINT ledger_kind_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_kind_check CHECK (kind IN ('bill', 'interest', 'payment', 'adjustment', 'opening', 'amenity'));
ALTER TABLE ledger ADD COLUMN booking_id integer REFERENCES bookings(id);

-- Register imports: what was loaded, by whom.
CREATE TABLE register_imports (
  id serial PRIMARY KEY,
  filename text NOT NULL,
  flats_created integer NOT NULL,
  flats_updated integer NOT NULL,
  residents_created integer NOT NULL,
  balances_posted integer NOT NULL,
  imported_by integer NOT NULL REFERENCES users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Tally exports: which date ranges went to Tally, so nothing is imported twice.
CREATE TABLE tally_exports (
  id serial PRIMARY KEY,
  from_date date NOT NULL,
  to_date date NOT NULL,
  vouchers integer NOT NULL,
  exported_by integer NOT NULL REFERENCES users(id),
  exported_at timestamptz NOT NULL DEFAULT now()
);
