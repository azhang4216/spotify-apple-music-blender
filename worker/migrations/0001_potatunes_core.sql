PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple')),
  provider_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS library_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple')),
  source_label TEXT,
  track_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  canonical_artist TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  normalized_artist TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  isrc TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS provider_tracks (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple')),
  provider_track_id TEXT NOT NULL,
  provider_uri TEXT,
  catalog_id TEXT,
  apple_type TEXT,
  title TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT,
  isrc TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  artwork_url TEXT,
  external_url TEXT,
  normalized_title TEXT NOT NULL,
  normalized_artist TEXT NOT NULL,
  strict_key TEXT NOT NULL,
  title_key TEXT NOT NULL,
  version_flags_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_track_id)
);

CREATE TABLE IF NOT EXISTS library_tracks (
  snapshot_id TEXT NOT NULL REFERENCES library_snapshots(id) ON DELETE CASCADE,
  provider_track_id TEXT NOT NULL REFERENCES provider_tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, provider_track_id)
);

CREATE TABLE IF NOT EXISTS blend_invites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_snapshot_id TEXT REFERENCES library_snapshots(id) ON DELETE SET NULL,
  share_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS blends (
  id TEXT PRIMARY KEY,
  invite_id TEXT REFERENCES blend_invites(id) ON DELETE SET NULL,
  host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_snapshot_id TEXT REFERENCES library_snapshots(id) ON DELETE SET NULL,
  guest_snapshot_id TEXT REFERENCES library_snapshots(id) ON DELETE SET NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blend_tracks (
  id TEXT PRIMARY KEY,
  blend_id TEXT NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  host_provider_track_id TEXT REFERENCES provider_tracks(id) ON DELETE SET NULL,
  guest_provider_track_id TEXT REFERENCES provider_tracks(id) ON DELETE SET NULL,
  spotify_provider_track_id TEXT REFERENCES provider_tracks(id) ON DELETE SET NULL,
  apple_provider_track_id TEXT REFERENCES provider_tracks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  isrc TEXT,
  score REAL NOT NULL DEFAULT 0,
  reason TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_exports (
  id TEXT PRIMARY KEY,
  blend_id TEXT NOT NULL REFERENCES blends(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('spotify', 'apple', 'csv')),
  provider_playlist_id TEXT,
  provider_playlist_url TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON library_snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON tracks(isrc);
CREATE INDEX IF NOT EXISTS idx_provider_tracks_provider_id ON provider_tracks(provider, provider_track_id);
CREATE INDEX IF NOT EXISTS idx_library_tracks_snapshot ON library_tracks(snapshot_id, position);
CREATE INDEX IF NOT EXISTS idx_invites_owner ON blend_invites(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_slug ON blend_invites(slug);
CREATE INDEX IF NOT EXISTS idx_blends_host ON blends(host_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blends_guest ON blends(guest_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blend_tracks_blend ON blend_tracks(blend_id, position);
CREATE INDEX IF NOT EXISTS idx_playlist_exports_blend ON playlist_exports(blend_id, created_at DESC);
