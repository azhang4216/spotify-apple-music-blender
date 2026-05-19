CREATE INDEX IF NOT EXISTS idx_blends_pair_created
ON blends(host_user_id, guest_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blends_reverse_pair_created
ON blends(guest_user_id, host_user_id, created_at DESC);
