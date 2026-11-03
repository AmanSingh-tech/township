-- A resident's mobile number is their login. Changing it would let one staff
-- member take over an account, so it waits for a second person, like money.
ALTER TABLE approvals DROP CONSTRAINT approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK (kind IN ('bank_post', 'bank_ignore', 'adjustment', 'phone_change'));
CREATE UNIQUE INDEX approvals_one_phone_change ON approvals ((payload->>'userId')) WHERE status = 'pending' AND kind = 'phone_change';
