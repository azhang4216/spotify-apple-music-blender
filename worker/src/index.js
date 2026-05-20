const MAX_APPLE_TOKEN_TTL_SECONDS = 15_777_000;
const MAX_SNAPSHOT_TRACKS = 12_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BLEND_REFRESH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const LIBRARY_REFRESH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDERS = new Set(["spotify", "apple"]);
const EXPORT_PROVIDERS = new Set(["spotify", "apple", "csv"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = cors(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (url.pathname === "/health") {
        return handleHealth(env, corsHeaders);
      }

      if (url.pathname === "/apple-music-token") {
        return handleAppleMusicToken(request, env, corsHeaders);
      }

      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Worker request failed";
      const details = error instanceof ApiError ? error.details : {};
      return json({ error: message, ...details }, status, corsHeaders);
    }
  },
};

async function handleHealth(env, corsHeaders) {
  const db = env.DB || null;
  let database = { configured: Boolean(db), migrated: false };

  if (db) {
    try {
      const rows = await db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions')")
        .all();
      const tables = new Set((rows.results || []).map((row) => row.name));
      database = { configured: true, migrated: tables.has("users") && tables.has("sessions") };
    } catch (error) {
      database = { configured: true, migrated: false, error: error.message };
    }
  }

  return json({ ok: true, database }, 200, corsHeaders);
}

async function handleAppleMusicToken(request, env, corsHeaders) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = clampTtl(env.APPLE_TOKEN_TTL_SECONDS);
  const developerToken = await generateAppleDeveloperToken(env, now, ttl);

  return json(
    {
      developerToken,
      expiresAt: new Date((now + ttl) * 1000).toISOString(),
      storefrontId: env.APPLE_STOREFRONT_ID || "us",
    },
    200,
    {
      ...corsHeaders,
      "Cache-Control": "public, max-age=300",
    },
  );
}

async function handleApi(request, env, url, corsHeaders) {
  const db = requiredDb(env);
  const [api, resource, id, child] = url.pathname.split("/").filter(Boolean);

  if (api !== "api") return json({ error: "Not found" }, 404, corsHeaders);

  if (resource === "auth" && request.method === "POST" && id === "spotify") {
    return json(await authenticateSpotify(db, await readJson(request)), 200, corsHeaders);
  }

  if (resource === "auth" && request.method === "POST" && id === "apple") {
    return json(await authenticateApple(db, env, await readJson(request)), 200, corsHeaders);
  }

  const session = await sessionFromRequest(db, request);

  if (resource === "me" && request.method === "GET" && !id) {
    return json({ user: requireSession(session).user }, 200, corsHeaders);
  }

  if (resource === "me" && request.method === "PATCH" && !id) {
    const auth = requireSession(session);
    return json({ user: await updateUserProfile(db, auth.user.id, await readJson(request)) }, 200, corsHeaders);
  }

  if (resource === "auth" && request.method === "POST" && id === "logout") {
    await revokeSession(db, requireSession(session));
    return json({ ok: true }, 200, corsHeaders);
  }

  if (resource === "users" && request.method === "POST" && !id) {
    return json({ error: "Use /api/auth/spotify or /api/auth/apple to create a user session." }, 400, corsHeaders);
  }

  if (resource === "users" && request.method === "GET" && id && child === "blends") {
    assertSessionUser(requireSession(session), id);
    return json({ blends: await listUserBlends(db, id, url) }, 200, corsHeaders);
  }

  if (resource === "users" && request.method === "GET" && id && child === "invites") {
    assertSessionUser(requireSession(session), id);
    return json({ invites: await listUserInvites(db, id, url) }, 200, corsHeaders);
  }

  if (resource === "users" && request.method === "GET" && id && child === "library-snapshot") {
    assertSessionUser(requireSession(session), id);
    const includeTracks = url.searchParams.get("tracks") === "true";
    return json({ snapshot: await getLatestLibrarySnapshot(db, id, includeTracks) }, 200, corsHeaders);
  }

  if (resource === "library-snapshots" && request.method === "POST" && !id) {
    const auth = requireSession(session);
    const body = await readJson(request);
    body.userId ||= auth.user.id;
    assertSessionUser(auth, body.userId || body.user_id);
    return json({ snapshot: await createLibrarySnapshot(db, body) }, 201, corsHeaders);
  }

  if (resource === "library-snapshots" && request.method === "GET" && id) {
    const snapshot = await getLibrarySnapshot(db, id);
    assertSessionUser(requireSession(session), snapshot.userId);
    return json({ snapshot }, 200, corsHeaders);
  }

  if (resource === "invites" && request.method === "POST" && !id) {
    const auth = requireSession(session);
    const body = await readJson(request);
    body.ownerUserId ||= auth.user.id;
    assertSessionUser(auth, body.ownerUserId || body.owner_user_id);
    return json({ invite: await createInvite(db, body) }, 201, corsHeaders);
  }

  if (resource === "invites" && request.method === "GET" && id) {
    const includeTracks = url.searchParams.get("tracks") === "true";
    if (includeTracks) requireSession(session);
    return json({ invite: await getInvite(db, id, includeTracks) }, 200, corsHeaders);
  }

  if (resource === "blends" && request.method === "POST" && !id) {
    const auth = requireSession(session);
    const body = await readJson(request);
    body.guestUserId ||= auth.user.id;
    assertSessionUser(auth, body.guestUserId || body.guest_user_id);
    return json({ blend: await createBlend(db, body) }, 201, corsHeaders);
  }

  if (resource === "blends" && request.method === "GET" && id) {
    const blend = await getBlend(db, id);
    assertBlendAccess(requireSession(session), blend);
    return json({ blend }, 200, corsHeaders);
  }

  if (resource === "playlist-exports" && request.method === "POST" && !id) {
    const auth = requireSession(session);
    const body = await readJson(request);
    body.userId ||= auth.user.id;
    assertSessionUser(auth, body.userId || body.user_id);
    return json({ export: await createPlaylistExport(db, body) }, 201, corsHeaders);
  }

  return json({ error: "Not found" }, 404, corsHeaders);
}

async function authenticateSpotify(db, body) {
  const accessToken = requireString(body.accessToken || body.access_token, "accessToken");
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok || !profile.id) {
    throw new ApiError(401, profile.error?.message || "Spotify token could not be verified.");
  }

  const user = await upsertUser(db, {
    provider: "spotify",
    providerUserId: profile.id,
    displayName: profile.display_name || profile.id || "Spotify listener",
    avatarUrl: profile.images?.[0]?.url || "",
    profileUrl: profile.external_urls?.spotify || "",
  });
  return { user, session: await createSession(db, user.id) };
}

async function authenticateApple(db, env, body) {
  const musicUserToken = requireString(body.musicUserToken || body.music_user_token, "musicUserToken");
  const developerToken = await generateAppleDeveloperToken(env, Math.floor(Date.now() / 1000), clampTtl(env.APPLE_TOKEN_TTL_SECONDS));
  const response = await fetch("https://api.music.apple.com/v1/me/storefront", {
    headers: {
      Authorization: `Bearer ${developerToken}`,
      "Music-User-Token": musicUserToken,
    },
  });
  const storefront = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(401, storefront.errors?.[0]?.detail || "Apple Music token could not be verified.");
  }

  const providerUserId = await hashId("appleuser", `${required(env.POTATUNES_SESSION_SECRET, "POTATUNES_SESSION_SECRET")}:${musicUserToken}`);
  const user = await upsertUser(db, {
    provider: "apple",
    providerUserId,
    displayName: stringValue(body.displayName || body.display_name) || "Apple Music listener",
  });
  return {
    user,
    session: await createSession(db, user.id),
    storefrontId: storefront.data?.[0]?.id || env.APPLE_STOREFRONT_ID || "us",
  };
}

async function createSession(db, userId) {
  const token = randomToken(32);
  const tokenHash = await hashId("session", token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(newId("sess"), userId, tokenHash, nowIso(), expiresAt)
    .run();
  return { token, expiresAt };
}

async function sessionFromRequest(db, request) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashId("session", token);
  const row = await db
    .prepare(`
      SELECT
        s.id AS session_id,
        s.expires_at,
        u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
    `)
    .bind(tokenHash, nowIso())
    .first();
  if (!row) return null;
  return {
    id: row.session_id,
    expiresAt: row.expires_at,
    user: serializeUser(row),
  };
}

async function revokeSession(db, session) {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(nowIso(), session.id).run();
}

function requireSession(session) {
  if (!session) throw new ApiError(401, "Sign in before using this Potatunes API route.");
  return session;
}

function assertSessionUser(session, userId) {
  if (session.user.id !== userId) throw new ApiError(403, "That Potatunes session cannot access this user.");
}

function assertBlendAccess(session, blend) {
  if (blend.hostUserId !== session.user.id && blend.guestUserId !== session.user.id) {
    throw new ApiError(403, "That Potatunes session cannot access this blend.");
  }
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function upsertUser(db, body) {
  const provider = requireProvider(body.provider);
  const providerUserId = requireString(body.providerUserId || body.provider_user_id, "providerUserId");
  const nextDisplayName = stringValue(body.displayName || body.display_name) || `${providerName(provider)} listener`;
  const avatarUrl = stringValue(body.avatarUrl || body.avatar_url);
  const profileUrl = stringValue(body.profileUrl || body.profile_url);
  const existing = await db
    .prepare("SELECT id, display_name FROM users WHERE provider = ? AND provider_user_id = ?")
    .bind(provider, providerUserId)
    .first();
  const id = existing?.id || newId("usr");
  const shouldKeepExistingName =
    existing &&
    isPlaceholderDisplayName(nextDisplayName, provider) &&
    !isPlaceholderDisplayName(existing.display_name, provider);
  const displayName = shouldKeepExistingName ? existing.display_name : nextDisplayName;
  const now = nowIso();

  await db
    .prepare(`
      INSERT INTO users (
        id, provider, provider_user_id, display_name, avatar_url, profile_url, created_at, updated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        profile_url = excluded.profile_url,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
    `)
    .bind(id, provider, providerUserId, displayName, avatarUrl, profileUrl, now, now, now)
    .run();

  return serializeUser(
    await db
      .prepare("SELECT * FROM users WHERE provider = ? AND provider_user_id = ?")
      .bind(provider, providerUserId)
      .first(),
  );
}

async function updateUserProfile(db, userId, body) {
  await findRequired(db, "users", userId);
  const displayName = requireString(body.displayName || body.display_name, "displayName").slice(0, 80);
  const now = nowIso();
  await db
    .prepare("UPDATE users SET display_name = ?, updated_at = ?, last_seen_at = ? WHERE id = ?")
    .bind(displayName, now, now, userId)
    .run();
  return serializeUser(await findRequired(db, "users", userId));
}

function isPlaceholderDisplayName(displayName, provider) {
  return !stringValue(displayName) || stringValue(displayName) === `${providerName(provider)} listener`;
}

async function createLibrarySnapshot(db, body) {
  const userId = requireString(body.userId || body.user_id, "userId");
  const user = await findRequired(db, "users", userId);
  const provider = body.provider ? requireProvider(body.provider) : user.provider;
  if (provider !== user.provider) {
    throw new ApiError(400, "Snapshot provider must match the user provider.");
  }

  const existing = await latestLibrarySnapshotRow(db, userId);
  if (existing && isLibrarySnapshotFresh(existing)) {
    return serializeSnapshot(existing);
  }

  const tracks = Array.isArray(body.tracks) ? body.tracks : [];
  if (!tracks.length) throw new ApiError(400, "tracks must include at least one song.");
  if (tracks.length > MAX_SNAPSHOT_TRACKS) {
    throw new ApiError(400, `tracks cannot exceed ${MAX_SNAPSHOT_TRACKS} songs.`);
  }

  const snapshotId = newId("snap");
  const now = nowIso();
  await db
    .prepare(`
      INSERT INTO library_snapshots (id, user_id, provider, source_label, track_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(snapshotId, userId, provider, stringValue(body.sourceLabel || body.source_label), tracks.length, now)
    .run();

  const statements = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = await normalizeStoredTrack(tracks[index], provider);
    statements.push(
      db
        .prepare(`
          INSERT INTO tracks (
            id, canonical_title, canonical_artist, normalized_title, normalized_artist, normalized_key,
            isrc, duration_ms, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(normalized_key) DO UPDATE SET
            canonical_title = excluded.canonical_title,
            canonical_artist = excluded.canonical_artist,
            isrc = COALESCE(excluded.isrc, tracks.isrc),
            duration_ms = CASE WHEN excluded.duration_ms > 0 THEN excluded.duration_ms ELSE tracks.duration_ms END,
            updated_at = excluded.updated_at
        `)
        .bind(
          track.trackId,
          track.title,
          track.primaryArtistDisplay,
          track.normalizedTitle,
          track.normalizedArtist,
          track.normalizedKey,
          track.isrc,
          track.durationMs,
          now,
          now,
        ),
      db
        .prepare(`
          INSERT INTO provider_tracks (
            id, track_id, provider, provider_track_id, provider_uri, catalog_id, apple_type, title,
            artists_json, album, isrc, duration_ms, artwork_url, external_url, normalized_title,
            normalized_artist, strict_key, title_key, version_flags_json, raw_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, provider_track_id) DO UPDATE SET
            track_id = excluded.track_id,
            provider_uri = excluded.provider_uri,
            catalog_id = excluded.catalog_id,
            apple_type = excluded.apple_type,
            title = excluded.title,
            artists_json = excluded.artists_json,
            album = excluded.album,
            isrc = excluded.isrc,
            duration_ms = excluded.duration_ms,
            artwork_url = excluded.artwork_url,
            external_url = excluded.external_url,
            normalized_title = excluded.normalized_title,
            normalized_artist = excluded.normalized_artist,
            strict_key = excluded.strict_key,
            title_key = excluded.title_key,
            version_flags_json = excluded.version_flags_json,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        `)
        .bind(
          track.providerTrackDbId,
          track.trackId,
          provider,
          track.providerTrackId,
          track.uri,
          track.catalogId,
          track.appleType,
          track.title,
          JSON.stringify(track.artists),
          track.album,
          track.isrc,
          track.durationMs,
          track.artworkUrl,
          track.externalUrl,
          track.normalizedTitle,
          track.normalizedArtist,
          track.strictKey,
          track.titleKey,
          JSON.stringify(track.versionFlags),
          track.rawJson,
          now,
          now,
        ),
      db
        .prepare(`
          INSERT OR IGNORE INTO library_tracks (snapshot_id, provider_track_id, position)
          VALUES (?, ?, ?)
        `)
        .bind(snapshotId, track.providerTrackDbId, index),
    );
  }

  for (const chunk of chunkArray(statements, 250)) {
    await db.batch(chunk);
  }

  return serializeSnapshot(await findRequired(db, "library_snapshots", snapshotId));
}

async function getLibrarySnapshot(db, snapshotId) {
  const snapshot = serializeSnapshot(await findRequired(db, "library_snapshots", snapshotId));
  return {
    ...snapshot,
    tracks: await getSnapshotTracks(db, snapshotId),
  };
}

async function getLatestLibrarySnapshot(db, userId, includeTracks) {
  await findRequired(db, "users", userId);
  const row = await latestLibrarySnapshotRow(db, userId);
  if (!row) return null;
  const snapshot = serializeSnapshot(row);
  return includeTracks ? { ...snapshot, tracks: await getSnapshotTracks(db, snapshot.id) } : snapshot;
}

async function latestLibrarySnapshotRow(db, userId) {
  return await db
    .prepare("SELECT * FROM library_snapshots WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(userId)
    .first();
}

function isLibrarySnapshotFresh(row) {
  const createdAtMs = Date.parse(row.created_at);
  return Number.isFinite(createdAtMs) && Date.now() - createdAtMs < LIBRARY_REFRESH_COOLDOWN_MS;
}

async function createInvite(db, body) {
  const ownerUserId = requireString(body.ownerUserId || body.owner_user_id, "ownerUserId");
  await findRequired(db, "users", ownerUserId);

  const ownerSnapshotId = stringValue(body.ownerSnapshotId || body.owner_snapshot_id);
  if (ownerSnapshotId) {
    const snapshot = await findRequired(db, "library_snapshots", ownerSnapshotId);
    if (snapshot.user_id !== ownerUserId) {
      throw new ApiError(400, "ownerSnapshotId must belong to ownerUserId.");
    }
  }

  const inviteId = newId("inv");
  const slug = await uniqueInviteSlug(db, body.slug);
  const now = nowIso();
  await db
    .prepare(`
      INSERT INTO blend_invites (id, slug, owner_user_id, owner_snapshot_id, share_url, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `)
    .bind(
      inviteId,
      slug,
      ownerUserId,
      ownerSnapshotId || null,
      stringValue(body.shareUrl || body.share_url),
      now,
      stringValue(body.expiresAt || body.expires_at),
    )
    .run();

  return await getInviteById(db, inviteId, false);
}

async function getInvite(db, slug, includeTracks) {
  const invite = await db
    .prepare(`
      SELECT
        i.*,
        u.provider AS owner_provider,
        u.display_name AS owner_display_name,
        u.avatar_url AS owner_avatar_url,
        s.track_count AS owner_track_count
      FROM blend_invites i
      JOIN users u ON u.id = i.owner_user_id
      LEFT JOIN library_snapshots s ON s.id = i.owner_snapshot_id
      WHERE i.slug = ?
    `)
    .bind(slug)
    .first();
  if (!invite) throw new ApiError(404, "Invite not found.");

  return serializeInvite(invite, includeTracks ? await getSnapshotTracks(db, invite.owner_snapshot_id) : undefined);
}

async function createBlend(db, body) {
  const guestUserId = requireString(body.guestUserId || body.guest_user_id, "guestUserId");
  await findRequired(db, "users", guestUserId);

  const invite = await findInviteForBlend(db, body);
  const guestSnapshotId = stringValue(body.guestSnapshotId || body.guest_snapshot_id);
  if (guestSnapshotId) {
    const snapshot = await findRequired(db, "library_snapshots", guestSnapshotId);
    if (snapshot.user_id !== guestUserId) {
      throw new ApiError(400, "guestSnapshotId must belong to guestUserId.");
    }
  }

  const matches = Array.isArray(body.matches) ? body.matches : [];
  const existingBlend = await findLatestBlendForPair(db, invite.owner_user_id, guestUserId);
  if (invite.owner_user_id === guestUserId) {
    throw new ApiError(409, "That is your own invite link.", {
      code: "self_invite",
    });
  }
  const refreshedFromBlendId = assertBlendRefreshAllowed(existingBlend, Boolean(body.refresh));
  const blendId = newId("blend");
  const now = nowIso();

  await db
    .prepare(`
      INSERT INTO blends (
        id, invite_id, host_user_id, guest_user_id, host_snapshot_id, guest_snapshot_id, match_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      blendId,
      invite.id,
      invite.owner_user_id,
      guestUserId,
      invite.owner_snapshot_id,
      guestSnapshotId || null,
      matches.length,
      now,
    )
    .run();

  if (matches.length) {
    const statements = matches.map((match, index) => {
      const stored = normalizeBlendTrack(match, index);
      return db
        .prepare(`
          INSERT INTO blend_tracks (
            id, blend_id, track_id, host_provider_track_id, guest_provider_track_id,
            spotify_provider_track_id, apple_provider_track_id, title, artists_json, isrc, score, reason, position
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          newId("bt"),
          blendId,
          stored.trackId || null,
          stored.hostProviderTrackId || null,
          stored.guestProviderTrackId || null,
          stored.spotifyProviderTrackId || null,
          stored.appleProviderTrackId || null,
          stored.title,
          JSON.stringify(stored.artists),
          stored.isrc,
          stored.score,
          stored.reason,
          index,
        );
    });

    for (const chunk of chunkArray(statements, 250)) {
      await db.batch(chunk);
    }
  }

  await db.prepare("UPDATE blend_invites SET status = 'used' WHERE id = ?").bind(invite.id).run();
  const blend = await getBlend(db, blendId);
  if (refreshedFromBlendId) {
    blend.refreshedFromBlendId = refreshedFromBlendId;
    blend.warning = "Refreshed an older mashed playlist for this spuddy pair.";
  }
  return blend;
}

async function findLatestBlendForPair(db, userAId, userBId) {
  if (!userAId || !userBId) return null;
  return await db
    .prepare(`
      SELECT
        b.*,
        host.provider AS host_provider,
        host.display_name AS host_display_name,
        host.avatar_url AS host_avatar_url,
        guest.provider AS guest_provider,
        guest.display_name AS guest_display_name,
        guest.avatar_url AS guest_avatar_url
      FROM blends b
      JOIN users host ON host.id = b.host_user_id
      JOIN users guest ON guest.id = b.guest_user_id
      WHERE
        (b.host_user_id = ? AND b.guest_user_id = ?)
        OR
        (b.host_user_id = ? AND b.guest_user_id = ?)
      ORDER BY b.created_at DESC
      LIMIT 1
    `)
    .bind(userAId, userBId, userBId, userAId)
    .first();
}

function assertBlendRefreshAllowed(existingBlend, requestedRefresh) {
  if (!existingBlend) return "";

  const createdAtMs = Date.parse(existingBlend.created_at);
  const refreshAtMs = Number.isFinite(createdAtMs) ? createdAtMs + BLEND_REFRESH_COOLDOWN_MS : Date.now() + BLEND_REFRESH_COOLDOWN_MS;
  const refreshAvailableAt = new Date(refreshAtMs).toISOString();
  const existing = summarizeExistingBlend(existingBlend, refreshAvailableAt);

  if (Date.now() < refreshAtMs) {
    throw new ApiError(409, "You already have a mashed playlist with this spuddy! You can refresh it after 1 week.", {
      code: "blend_already_exists",
      canRefresh: false,
      refreshAvailableAt,
      existingBlend: existing,
    });
  }

  if (!requestedRefresh) {
    throw new ApiError(409, "You already have a mashed playlist with this spuddy! It is older than 1 week, so you can refresh it.", {
      code: "blend_refresh_available",
      canRefresh: true,
      refreshAvailableAt,
      existingBlend: existing,
    });
  }

  return existingBlend.id;
}

function summarizeExistingBlend(row, refreshAvailableAt) {
  return {
    id: row.id,
    createdAt: row.created_at,
    refreshAvailableAt,
    matchCount: row.match_count,
    host: {
      id: row.host_user_id,
      provider: row.host_provider,
      displayName: row.host_display_name,
    },
    guest: {
      id: row.guest_user_id,
      provider: row.guest_provider,
      displayName: row.guest_display_name,
    },
  };
}

async function getBlend(db, blendId) {
  const blend = await db
    .prepare(`
      SELECT
        b.*,
        host.provider AS host_provider,
        host.display_name AS host_display_name,
        host.avatar_url AS host_avatar_url,
        guest.provider AS guest_provider,
        guest.display_name AS guest_display_name,
        guest.avatar_url AS guest_avatar_url
      FROM blends b
      JOIN users host ON host.id = b.host_user_id
      JOIN users guest ON guest.id = b.guest_user_id
      WHERE b.id = ?
    `)
    .bind(blendId)
    .first();
  if (!blend) throw new ApiError(404, "Blend not found.");

  const tracks = await db
    .prepare("SELECT * FROM blend_tracks WHERE blend_id = ? ORDER BY position ASC")
    .bind(blendId)
    .all();
  const exports = await db
    .prepare("SELECT * FROM playlist_exports WHERE blend_id = ? ORDER BY created_at DESC")
    .bind(blendId)
    .all();

  return {
    ...serializeBlend(blend),
    tracks: (tracks.results || []).map(serializeBlendTrack),
    exports: (exports.results || []).map(serializePlaylistExport),
  };
}

async function listUserBlends(db, userId, url) {
  await findRequired(db, "users", userId);
  const limit = boundedLimit(url.searchParams.get("limit"), 50, 100);
  const rows = await db
    .prepare(`
      SELECT
        b.*,
        host.provider AS host_provider,
        host.display_name AS host_display_name,
        host.avatar_url AS host_avatar_url,
        guest.provider AS guest_provider,
        guest.display_name AS guest_display_name,
        guest.avatar_url AS guest_avatar_url
      FROM blends b
      JOIN users host ON host.id = b.host_user_id
      JOIN users guest ON guest.id = b.guest_user_id
      WHERE b.host_user_id = ? OR b.guest_user_id = ?
      ORDER BY b.created_at DESC
      LIMIT ?
    `)
    .bind(userId, userId, limit)
    .all();

  return (rows.results || []).map((row) => {
    const blend = serializeBlend(row);
    const friend = row.host_user_id === userId ? blend.guest : blend.host;
    return { ...blend, friend };
  });
}

async function listUserInvites(db, userId, url) {
  await findRequired(db, "users", userId);
  const limit = boundedLimit(url.searchParams.get("limit"), 25, 100);
  const rows = await db
    .prepare(`
      SELECT
        i.*,
        u.provider AS owner_provider,
        u.display_name AS owner_display_name,
        u.avatar_url AS owner_avatar_url,
        s.track_count AS owner_track_count
      FROM blend_invites i
      JOIN users u ON u.id = i.owner_user_id
      LEFT JOIN library_snapshots s ON s.id = i.owner_snapshot_id
      WHERE i.owner_user_id = ?
      ORDER BY i.created_at DESC
      LIMIT ?
    `)
    .bind(userId, limit)
    .all();

  return (rows.results || []).map((row) => serializeInvite(row));
}

async function createPlaylistExport(db, body) {
  const blendId = requireString(body.blendId || body.blend_id, "blendId");
  await findRequired(db, "blends", blendId);
  const provider = requireExportProvider(body.provider);
  const userId = stringValue(body.userId || body.user_id);
  if (userId) await findRequired(db, "users", userId);

  const id = newId("exp");
  await db
    .prepare(`
      INSERT INTO playlist_exports (
        id, blend_id, user_id, provider, provider_playlist_id, provider_playlist_url, item_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      blendId,
      userId || null,
      provider,
      stringValue(body.providerPlaylistId || body.provider_playlist_id),
      stringValue(body.providerPlaylistUrl || body.provider_playlist_url),
      integerValue(body.itemCount || body.item_count),
      nowIso(),
    )
    .run();

  return serializePlaylistExport(await findRequired(db, "playlist_exports", id));
}

async function findInviteForBlend(db, body) {
  const inviteId = stringValue(body.inviteId || body.invite_id);
  const inviteSlug = stringValue(body.inviteSlug || body.invite_slug || body.slug);

  const query = inviteId
    ? db.prepare("SELECT * FROM blend_invites WHERE id = ?").bind(inviteId)
    : db.prepare("SELECT * FROM blend_invites WHERE slug = ?").bind(requireString(inviteSlug, "inviteSlug"));
  const invite = await query.first();
  if (!invite) throw new ApiError(404, "Invite not found.");
  if (invite.status === "revoked") throw new ApiError(409, "Invite was revoked.");
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    throw new ApiError(409, "Invite expired.");
  }
  return invite;
}

async function getInviteById(db, id, includeTracks) {
  const invite = await db
    .prepare(`
      SELECT
        i.*,
        u.provider AS owner_provider,
        u.display_name AS owner_display_name,
        u.avatar_url AS owner_avatar_url,
        s.track_count AS owner_track_count
      FROM blend_invites i
      JOIN users u ON u.id = i.owner_user_id
      LEFT JOIN library_snapshots s ON s.id = i.owner_snapshot_id
      WHERE i.id = ?
    `)
    .bind(id)
    .first();
  if (!invite) throw new ApiError(404, "Invite not found.");
  return serializeInvite(invite, includeTracks ? await getSnapshotTracks(db, invite.owner_snapshot_id) : undefined);
}

async function getSnapshotTracks(db, snapshotId) {
  if (!snapshotId) return [];
  const rows = await db
    .prepare(`
      SELECT pt.*, lt.position
      FROM library_tracks lt
      JOIN provider_tracks pt ON pt.id = lt.provider_track_id
      WHERE lt.snapshot_id = ?
      ORDER BY lt.position ASC
    `)
    .bind(snapshotId)
    .all();
  return (rows.results || []).map(serializeProviderTrack);
}

async function normalizeStoredTrack(input, provider) {
  const title = stringValue(input.title) || "Untitled";
  const artists = normalizeArtists(input.artists);
  const primaryArtistDisplay = artists[0] || "Unknown artist";
  const isrc = cleanIsrc(input.isrc);
  const norm = input.norm || {};
  const normalizedTitle = stringValue(input.normTitle || norm.title) || basicNormalize(title);
  const normalizedArtist = stringValue(input.primaryArtist || norm.primaryArtist) || basicNormalize(primaryArtistDisplay);
  const strictKey = stringValue(input.strictKey || norm.strictKey) || `${normalizedTitle}::${normalizedArtist}`;
  const titleKey = stringValue(input.titleKey || norm.titleKey) || normalizedTitle;
  const normalizedKey = isrc ? `isrc:${isrc}` : `strict:${strictKey}`;
  const providerTrackId =
    stringValue(input.providerTrackId || input.provider_track_id || input.id || input.uri) ||
    (await hashId("native", `${provider}:${normalizedKey}`));

  return {
    trackId: await hashId("trk", normalizedKey),
    providerTrackDbId: await hashId("ptr", `${provider}:${providerTrackId}`),
    providerTrackId,
    uri: stringValue(input.uri),
    catalogId: stringValue(input.catalogId || input.catalog_id),
    appleType: stringValue(input.appleType || input.apple_type),
    title,
    artists,
    primaryArtistDisplay,
    album: stringValue(input.album),
    isrc,
    durationMs: integerValue(input.durationMs || input.duration_ms),
    artworkUrl: stringValue(input.artworkUrl || input.artwork_url),
    externalUrl: stringValue(input.url || input.externalUrl || input.external_url),
    normalizedTitle,
    normalizedArtist,
    normalizedKey,
    strictKey,
    titleKey,
    versionFlags: Array.isArray(input.versionFlags || norm.versionFlags) ? input.versionFlags || norm.versionFlags : [],
    rawJson: input.raw ? JSON.stringify(input.raw).slice(0, 20_000) : null,
  };
}

function normalizeBlendTrack(match, index) {
  const host = match.hostTrack || match.host || {};
  const guest = match.yourTrack || match.guestTrack || match.guest || {};
  const display = match.track || (guest.title ? guest : host);
  const artists = normalizeArtists(match.artists || display.artists);
  const hostProviderTrackId = stringValue(match.hostProviderTrackDbId || host.providerTrackDbId || host.dbId);
  const guestProviderTrackId = stringValue(match.guestProviderTrackDbId || guest.providerTrackDbId || guest.dbId);
  const spotifyProviderTrackId =
    stringValue(match.spotifyProviderTrackDbId) ||
    (host.service === "spotify" ? hostProviderTrackId : "") ||
    (guest.service === "spotify" ? guestProviderTrackId : "");
  const appleProviderTrackId =
    stringValue(match.appleProviderTrackDbId) ||
    (host.service === "apple" ? hostProviderTrackId : "") ||
    (guest.service === "apple" ? guestProviderTrackId : "");

  return {
    trackId: stringValue(match.trackId || match.track_id),
    hostProviderTrackId,
    guestProviderTrackId,
    spotifyProviderTrackId,
    appleProviderTrackId,
    title: stringValue(match.title || display.title) || `Shared song ${index + 1}`,
    artists,
    isrc: cleanIsrc(match.isrc || display.isrc || host.isrc || guest.isrc),
    score: numberValue(match.score),
    reason: stringValue(match.reason),
  };
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || "",
    profileUrl: row.profile_url || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
  };
}

function serializeSnapshot(row) {
  const createdAtMs = Date.parse(row.created_at);
  const refreshAtMs = Number.isFinite(createdAtMs) ? createdAtMs + LIBRARY_REFRESH_COOLDOWN_MS : Date.now();
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    sourceLabel: row.source_label || "",
    trackCount: row.track_count,
    createdAt: row.created_at,
    canRefresh: Date.now() >= refreshAtMs,
    refreshAvailableAt: new Date(refreshAtMs).toISOString(),
  };
}

function serializeInvite(row, tracks) {
  const invite = {
    id: row.id,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    ownerSnapshotId: row.owner_snapshot_id || "",
    shareUrl: row.share_url || "",
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at || "",
    owner: {
      id: row.owner_user_id,
      provider: row.owner_provider,
      displayName: row.owner_display_name,
      avatarUrl: row.owner_avatar_url || "",
      trackCount: row.owner_track_count || 0,
    },
  };
  if (tracks) invite.tracks = tracks;
  return invite;
}

function serializeProviderTrack(row) {
  return {
    id: row.id,
    trackId: row.track_id,
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    uri: row.provider_uri || "",
    catalogId: row.catalog_id || "",
    appleType: row.apple_type || "",
    title: row.title,
    artists: safeJson(row.artists_json, []),
    album: row.album || "",
    isrc: row.isrc || "",
    durationMs: row.duration_ms || 0,
    artworkUrl: row.artwork_url || "",
    url: row.external_url || "",
    norm: {
      title: row.normalized_title,
      primaryArtist: row.normalized_artist,
      strictKey: row.strict_key,
      titleKey: row.title_key,
      versionFlags: safeJson(row.version_flags_json, []),
    },
  };
}

function serializeBlend(row) {
  return {
    id: row.id,
    inviteId: row.invite_id || "",
    hostUserId: row.host_user_id,
    guestUserId: row.guest_user_id,
    hostSnapshotId: row.host_snapshot_id || "",
    guestSnapshotId: row.guest_snapshot_id || "",
    matchCount: row.match_count,
    createdAt: row.created_at,
    host: {
      id: row.host_user_id,
      provider: row.host_provider,
      displayName: row.host_display_name,
      avatarUrl: row.host_avatar_url || "",
    },
    guest: {
      id: row.guest_user_id,
      provider: row.guest_provider,
      displayName: row.guest_display_name,
      avatarUrl: row.guest_avatar_url || "",
    },
  };
}

function serializeBlendTrack(row) {
  return {
    id: row.id,
    blendId: row.blend_id,
    trackId: row.track_id || "",
    hostProviderTrackId: row.host_provider_track_id || "",
    guestProviderTrackId: row.guest_provider_track_id || "",
    spotifyProviderTrackId: row.spotify_provider_track_id || "",
    appleProviderTrackId: row.apple_provider_track_id || "",
    title: row.title,
    artists: safeJson(row.artists_json, []),
    isrc: row.isrc || "",
    score: row.score,
    reason: row.reason || "",
    position: row.position,
  };
}

function serializePlaylistExport(row) {
  return {
    id: row.id,
    blendId: row.blend_id,
    userId: row.user_id || "",
    provider: row.provider,
    providerPlaylistId: row.provider_playlist_id || "",
    providerPlaylistUrl: row.provider_playlist_url || "",
    itemCount: row.item_count,
    createdAt: row.created_at,
  };
}

async function uniqueInviteSlug(db, requested) {
  const cleaned = stringValue(requested).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  if (cleaned) {
    const existing = await db.prepare("SELECT id FROM blend_invites WHERE slug = ?").bind(cleaned).first();
    if (!existing) return cleaned;
  }

  for (let index = 0; index < 5; index += 1) {
    const slug = randomSlug(10);
    const existing = await db.prepare("SELECT id FROM blend_invites WHERE slug = ?").bind(slug).first();
    if (!existing) return slug;
  }
  throw new ApiError(500, "Could not create a unique invite slug.");
}

async function findRequired(db, table, id) {
  const allowed = new Set(["users", "library_snapshots", "blends", "playlist_exports"]);
  if (!allowed.has(table)) throw new ApiError(500, "Invalid table lookup.");
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new ApiError(404, `${table.slice(0, -1)} not found.`);
  return row;
}

function requiredDb(env) {
  if (!env.DB) throw new ApiError(500, "D1 database binding DB is not configured.");
  return env.DB;
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    throw new ApiError(415, "Expected application/json.");
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body.");
  }
}

function requireProvider(value) {
  const provider = stringValue(value);
  if (!PROVIDERS.has(provider)) throw new ApiError(400, "provider must be spotify or apple.");
  return provider;
}

function requireExportProvider(value) {
  const provider = stringValue(value);
  if (!EXPORT_PROVIDERS.has(provider)) throw new ApiError(400, "provider must be spotify, apple, or csv.");
  return provider;
}

function requireString(value, name) {
  const normalized = stringValue(value);
  if (!normalized) throw new ApiError(400, `${name} is required.`);
  return normalized;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function boundedLimit(value, fallback, max) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function normalizeArtists(value) {
  if (Array.isArray(value)) {
    const artists = value.map((artist) => stringValue(artist)).filter(Boolean);
    if (artists.length) return artists;
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return ["Unknown artist"];
}

function providerName(provider) {
  return provider === "spotify" ? "Spotify" : "Apple Music";
}

function cleanIsrc(value) {
  return stringValue(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function basicNormalize(value) {
  return stringValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9()[\]{}\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function hashId(prefix, value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `${prefix}_${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function randomSlug(length) {
  const alphabet = "23456789abcdefghijkmnopqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function nowIso() {
  return new Date().toISOString();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || "*";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    Vary: "Origin",
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function generateAppleDeveloperToken(env, now, ttl) {
  const teamId = required(env.APPLE_TEAM_ID, "APPLE_TEAM_ID");
  const keyId = required(env.APPLE_KEY_ID, "APPLE_KEY_ID");
  const privateKey = normalizePrivateKey(required(env.APPLE_MEDIA_SERVICES_PRIVATE_KEY, "APPLE_MEDIA_SERVICES_PRIVATE_KEY"));

  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + ttl,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await signEs256(signingInput, privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

async function signEs256(signingInput, pem) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
}

function clampTtl(value) {
  const parsed = Number(value || 3600);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3600;
  return Math.min(Math.floor(parsed), MAX_APPLE_TOKEN_TTL_SECONDS);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function normalizePrivateKey(value) {
  const withNewlines = String(value).replace(/\\n/g, "\n").trim();
  if (withNewlines.includes("BEGIN PRIVATE KEY")) return withNewlines;

  return [
    "-----BEGIN PRIVATE KEY-----",
    withNewlines.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") || "",
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
