-- Indexes and outbox changes found by the full-size load test (load/).

-- Receipts find their ledger line; the gate lists today's entries; Tally and
-- reports read date ranges; bill alerts find a run's bills; the help desk
-- list counts each complaint's linked reports.
CREATE INDEX ledger_payment ON ledger (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX ledger_on_date ON ledger (on_date);
CREATE INDEX payments_paid_on ON payments (paid_on);
CREATE INDEX visitors_created ON visitors (created_at);
CREATE INDEX complaints_created ON complaints (created_at);
CREATE INDEX complaints_duplicate ON complaints (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX bills_run ON bills (bill_run_id) WHERE bill_run_id IS NOT NULL;
CREATE INDEX guest_codes_valid ON guest_codes (valid_on);

-- Outbox: urgent messages (a visitor at the gate, a safety alert) go before
-- bulk ones such as a month's bill alerts. A batch is claimed ('sending') in
-- a short transaction and delivered outside it; a claim older than five
-- minutes (a crashed worker) is put back in the queue.
ALTER TABLE messages ADD COLUMN priority smallint NOT NULL DEFAULT 5;
ALTER TABLE messages ADD COLUMN claimed_at timestamptz;
ALTER TABLE messages DROP CONSTRAINT messages_status_check;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped'));
CREATE INDEX messages_queue ON messages (priority, id) WHERE status IN ('queued', 'sending');
