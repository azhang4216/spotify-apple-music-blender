const STORAGE = {
  spotifyToken: "potatunes.spotifyToken",
  spotifyOAuth: "potatunes.spotifyOAuth",
  pendingInvite: "potatunes.pendingInvite",
  appleUserToken: "potatunes.appleUserToken",
  appSnapshot: "potatunes.appSnapshot",
};

const DEFAULT_CONFIG = {
  appName: "Potatunes",
  appBuild: "1.0.0",
  spotifyClientId: "",
  spotifyRedirectUri: "",
  appleDeveloperToken: "",
  appleTokenEndpoint: "",
  appleStorefrontId: "us",
};

const SERVICES = {
  spotify: {
    name: "Spotify",
    sourceLabel: "Saved tracks",
  },
  apple: {
    name: "Apple Music",
    sourceLabel: "Library songs",
  },
};

const VERSION_WORDS = new Set([
  "album",
  "anniversary",
  "bonus",
  "clean",
  "deluxe",
  "edit",
  "edition",
  "explicit",
  "extended",
  "mix",
  "mono",
  "original",
  "radio",
  "remaster",
  "remastered",
  "single",
  "stereo",
  "version",
]);

const PENALTY_VERSION_WORDS = new Set(["acoustic", "instrumental", "karaoke", "live", "remix"]);

const state = {
  config: { ...DEFAULT_CONFIG },
  invite: null,
  session: null,
  matches: [],
  busy: false,
  shareLink: "",
  walkthroughIndex: null,
};

const WALKTHROUGH_STEPS = [
  {
    title: "Pick your app",
    copy: "Potatunes digs up a sample Spotify sack.",
    scene: "pick",
    button: "Next",
  },
  {
    title: "Send the hot potato",
    copy: "A friend opens the link and brings their Apple Music sack.",
    scene: "share",
    button: "Next",
  },
  {
    title: "Mash the overlap",
    copy: "Potatunes keeps only the tunes in both sacks.",
    scene: "match",
    button: "Show sample",
  },
];

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  await loadExternalConfig();
  loadConfig();
  attachEvents();
  loadInviteFromLocation();

  const handledSpotifyCallback = await handleSpotifyCallback();
  if (!handledSpotifyCallback) {
    render();
  }
}

function bindElements() {
  [
    "appleButton",
    "configBadge",
    "connectCopy",
    "connectPanel",
    "connectTitle",
    "copyInviteButton",
    "demoButton",
    "downloadPackButton",
    "exportCsvButton",
    "homeButton",
    "importButton",
    "importFile",
    "inviteCopy",
    "inviteCount",
    "inviteLink",
    "invitePanel",
    "libraryCopy",
    "libraryCounter",
    "libraryPanel",
    "libraryTitle",
    "linkWarning",
    "matchCount",
    "matchList",
    "modeBanner",
    "progressFill",
    "resetButton",
    "resultCopy",
    "resultStats",
    "resultTitle",
    "resultsPanel",
    "sampleArtwork",
    "appleExportButton",
    "spotifyExportButton",
    "spotifyButton",
    "statusLog",
    "stepBlend",
    "stepCollect",
    "stepConnect",
    "walkthroughCloseButton",
    "walkthroughCopy",
    "walkthroughNextButton",
    "walkthroughPanel",
    "walkthroughStep",
    "walkthroughTitle",
    "walkthroughVisual",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function loadConfig() {
  state.config = {
    ...DEFAULT_CONFIG,
    ...(window.BLEND_CONFIG || {}),
  };

  if (!state.config.spotifyRedirectUri) {
    state.config.spotifyRedirectUri = `${window.location.origin}${window.location.pathname}`;
  }
}

async function loadExternalConfig() {
  try {
    const response = await fetch("./config.js", { cache: "no-store" });
    if (!response.ok) return;
    const script = await response.text();
    Function(script)();
  } catch {
    // config.js is optional so the app can run in demo/import mode from a fresh clone.
  }
}

function attachEvents() {
  els.spotifyButton.addEventListener("click", () => connectService("spotify"));
  els.appleButton.addEventListener("click", () => connectService("apple"));
  els.demoButton.addEventListener("click", startWalkthrough);
  els.homeButton.addEventListener("click", goHome);
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importBlendPack);
  els.copyInviteButton.addEventListener("click", copyInviteLink);
  els.downloadPackButton.addEventListener("click", downloadBlendPack);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.spotifyExportButton.addEventListener("click", () => createPlaylist("spotify"));
  els.appleExportButton.addEventListener("click", () => createPlaylist("apple"));
  els.resetButton.addEventListener("click", goHome);
  els.walkthroughNextButton.addEventListener("click", advanceWalkthrough);
  els.walkthroughCloseButton.addEventListener("click", goHome);
}

function loadInviteFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) {
    const pending = sessionStorage.getItem(STORAGE.pendingInvite);
    if (pending) {
      state.invite = safeJsonParse(pending);
    }
    return;
  }

  const params = new URLSearchParams(hash);
  const encodedInvite = params.get("join");
  if (!encodedInvite) return;

  parseInvitePayload(encodedInvite)
    .then((invite) => {
      state.invite = invite;
      sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(invite));
      render();
    })
    .catch(() => {
      setStatus("That spud link could not be opened. Try importing a sack instead.", "error");
      render();
    });
}

async function connectService(service) {
  if (state.busy) return;

  if (service === "spotify") {
    if (!state.config.spotifyClientId) {
      setStatus("Add a Spotify client ID in config.js before connecting Spotify.", "error");
      return;
    }
    sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(state.invite));
    await beginSpotifyAuth("collect");
    return;
  }

  if (!hasAppleTokenSource()) {
    setStatus("Add an Apple token endpoint before connecting Apple Music.", "error");
    return;
  }

  await connectApple();
}

async function beginSpotifyAuth(action = "collect") {
  const verifier = randomString(96);
  const challenge = await pkceChallenge(verifier);
  const csrfState = randomString(32);
  const scope = [
    "user-library-read",
    "user-read-private",
    "playlist-modify-private",
    "playlist-modify-public",
  ].join(" ");

  sessionStorage.setItem(
    STORAGE.spotifyOAuth,
    JSON.stringify({
      verifier,
      state: csrfState,
      redirectUri: state.config.spotifyRedirectUri,
      action,
      createdAt: Date.now(),
    }),
  );

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: state.config.spotifyClientId,
    scope,
    redirect_uri: state.config.spotifyRedirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: csrfState,
  }).toString();

  window.location.assign(authUrl.toString());
}

async function handleSpotifyCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthError = params.get("error");
  if (!code && !oauthError) return false;

  const oauth = safeJsonParse(sessionStorage.getItem(STORAGE.spotifyOAuth));
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);

  if (oauthError) {
    setStatus(`Spotify sign-in stopped: ${oauthError}`, "error");
    render();
    return true;
  }

  if (!oauth || oauth.state !== params.get("state")) {
    setStatus("Spotify sign-in could not be verified. Please try again.", "error");
    render();
    return true;
  }

  const pending = sessionStorage.getItem(STORAGE.pendingInvite);
  if (pending) state.invite = safeJsonParse(pending);

  try {
    setBusy(true, "Finishing Spotify sign-in...");
    const token = await exchangeSpotifyCode(code, oauth);
    saveSpotifyToken(token);
    if (oauth.action === "export-spotify") {
      restoreAppSnapshot();
      await createSpotifyPlaylist();
    } else {
      await finishSpotifyConnection();
    }
  } catch (error) {
    setStatus(error.message || "Spotify sign-in failed.", "error");
  } finally {
    setBusy(false);
    render();
  }

  return true;
}

async function exchangeSpotifyCode(code, oauth) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: state.config.spotifyClientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: oauth.redirectUri,
      code_verifier: oauth.verifier,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.error || "Spotify token exchange failed.");
  }
  return body;
}

function saveSpotifyToken(token) {
  sessionStorage.setItem(
    STORAGE.spotifyToken,
    JSON.stringify({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000 - 60000,
    }),
  );
}

async function getSpotifyAccessToken() {
  const token = safeJsonParse(sessionStorage.getItem(STORAGE.spotifyToken));
  if (!token?.accessToken) throw new Error("Spotify is not connected.");
  if (token.expiresAt > Date.now()) return token.accessToken;
  if (!token.refreshToken) throw new Error("Spotify token expired. Connect again.");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: state.config.spotifyClientId,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.error || "Could not refresh Spotify token.");
  }

  const nextToken = {
    ...token,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || token.refreshToken,
    expiresAt: Date.now() + (body.expires_in || 3600) * 1000 - 60000,
  };
  sessionStorage.setItem(STORAGE.spotifyToken, JSON.stringify(nextToken));
  return nextToken.accessToken;
}

async function finishSpotifyConnection() {
  state.session = {
    service: "spotify",
    profile: { name: "Spotify listener" },
    tracks: [],
  };
  renderCollecting("Spotify", 0, 4);

  const accessToken = await getSpotifyAccessToken();
  state.session.profile = await fetchSpotifyProfile(accessToken);
  const tracks = await fetchSpotifySavedTracks(accessToken);
  state.session.tracks = dedupeTracks(tracks);

  await finishCollection();
}

async function fetchSpotifyProfile(accessToken) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { name: "Spotify listener" };
  const body = await response.json();
  return {
    name: body.display_name || body.id || "Spotify listener",
    id: body.id,
    url: body.external_urls?.spotify,
  };
}

async function fetchSpotifySavedTracks(accessToken) {
  const tracks = [];
  let url = "https://api.spotify.com/v1/me/tracks?limit=50&offset=0";

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error?.message || "Could not read Spotify saved tracks.");
    }

    for (const item of body.items || []) {
      const track = item.track;
      if (!track || track.is_local) continue;
      tracks.push(toTrack({
        service: "spotify",
        id: track.id,
        uri: track.uri,
        title: track.name,
        artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
        album: track.album?.name || "",
        durationMs: track.duration_ms,
        isrc: track.external_ids?.isrc || "",
        artworkUrl: bestSpotifyImage(track.album?.images),
        url: track.external_urls?.spotify || "",
      }));
    }

    if (state.session?.service === "spotify") state.session.tracks = tracks;
    updateLibraryProgress(tracks.length, body.total || tracks.length);
    url = body.next;
  }

  return tracks;
}

function bestSpotifyImage(images = []) {
  return [...images].sort((a, b) => Math.abs((a.width || 0) - 300) - Math.abs((b.width || 0) - 300))[0]?.url || "";
}

async function connectApple() {
  try {
    setBusy(true, "Opening Apple Music...");
    await configureMusicKit();
    const music = window.MusicKit.getInstance();
    const userToken = await music.authorize();
    sessionStorage.setItem(STORAGE.appleUserToken, userToken || music.musicUserToken || "");

    state.session = {
      service: "apple",
      profile: { name: "Apple Music listener" },
      tracks: [],
    };
    renderCollecting("Apple Music", 0, 4);
    const tracks = await fetchAppleLibrarySongs(music);
    state.session.tracks = dedupeTracks(await preferAppleLikedTracks(tracks, music));
    await finishCollection();
  } catch (error) {
    setStatus(error.message || "Apple Music connection failed.", "error");
  } finally {
    setBusy(false);
    render();
  }
}

async function configureMusicKit() {
  await waitFor(() => window.MusicKit, 8000);
  try {
    if (window.MusicKit.getInstance()) return;
  } catch {
    // MusicKit throws before the first configure call in some versions.
  }

  const developerToken = await getAppleDeveloperToken();
  window.MusicKit.configure({
    developerToken,
    app: {
      name: state.config.appName,
      build: state.config.appBuild,
    },
    storefrontId: state.config.appleStorefrontId || "us",
    suppressErrorDialog: true,
  });
}

async function fetchAppleLibrarySongs(music) {
  const tracks = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await music.api.library.songs({ limit, offset });
    const data = response?.data || [];
    for (const song of data) {
      tracks.push(toTrack({
        service: "apple",
        id: song.id,
        uri: song.id,
        title: song.attributes?.name,
        artists: splitAppleArtists(song.attributes?.artistName),
        album: song.attributes?.albumName || "",
        durationMs: song.attributes?.durationInMillis || 0,
        isrc: song.attributes?.isrc || "",
        artworkUrl: appleArtworkUrl(song.attributes?.artwork?.url),
        url: song.attributes?.url || "",
        appleType: song.type || "library-songs",
        catalogId: song.attributes?.playParams?.catalogId || "",
      }));
    }

    if (state.session?.service === "apple") state.session.tracks = tracks;
    updateLibraryProgress(tracks.length, response?.meta?.total || tracks.length + (data.length === limit ? limit : 0));
    offset += limit;
    hasMore = data.length === limit;
  }

  return tracks;
}

function splitAppleArtists(artistName = "") {
  return artistName
    .split(/\s+(?:&|and|x)\s+|,\s*/i)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function appleArtworkUrl(template = "") {
  if (!template) return "";
  return template.replace("{w}", "300").replace("{h}", "300");
}

async function preferAppleLikedTracks(tracks, music) {
  if (!tracks.length) return tracks;

  const userToken = music.musicUserToken || sessionStorage.getItem(STORAGE.appleUserToken);
  if (!hasAppleTokenSource() || !userToken) return tracks;
  const developerToken = await getAppleDeveloperToken();

  try {
    const likedIds = new Set();
    for (const chunk of chunkArray(tracks, 25)) {
      const ids = chunk.map((track) => track.id).filter(Boolean).join(",");
      if (!ids) continue;
      const response = await fetch(
        `https://api.music.apple.com/v1/me/ratings/library-songs?ids=${encodeURIComponent(ids)}`,
        {
          headers: {
            Authorization: `Bearer ${developerToken}`,
            "Music-User-Token": userToken,
          },
        },
      );
      if (!response.ok) return tracks;
      const body = await response.json();
      for (const rating of body.data || []) {
        if (rating.attributes?.value === 1) likedIds.add(rating.id);
      }
    }

    if (!likedIds.size) {
      setStatus("Apple did not return liked-song ratings, so Potatunes used library tunes.", "info");
      return tracks;
    }

    setStatus(`Apple Music found ${likedIds.size} liked tunes. Mashing those.`, "info");
    return tracks.filter((track) => likedIds.has(track.id));
  } catch {
    return tracks;
  }
}

async function finishCollection() {
  if (!state.session?.tracks?.length) {
    setStatus("No tunes were found for this account.", "error");
    return;
  }

  if (state.invite) {
    state.matches = matchTracks(state.invite.tracks, state.session.tracks);
    setStatus(`Found ${state.matches.length} shared tune${state.matches.length === 1 ? "" : "s"}.`, "info");
    return;
  }

  const invite = createInviteFromSession();
  state.invite = invite;
  sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(invite));
  state.shareLink = await createShareLink(invite);
  setStatus("Spud link ready.", "info");
}

function createInviteFromSession() {
  return {
    v: 1,
    blendId: crypto.randomUUID?.() || randomString(24),
    createdAt: new Date().toISOString(),
    host: {
      name: state.session.profile?.name || `${SERVICES[state.session.service].name} listener`,
      service: state.session.service,
      sourceLabel: SERVICES[state.session.service].sourceLabel,
      count: state.session.tracks.length,
    },
    tracks: state.session.tracks.map(compactTrackForInvite),
  };
}

function compactTrackForInvite(track) {
  return {
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    normTitle: track.norm.title,
    normArtists: track.norm.artists,
    primaryArtist: track.norm.primaryArtist,
    strictKey: track.norm.strictKey,
    titleKey: track.norm.titleKey,
    versionFlags: track.norm.versionFlags,
  };
}

async function createShareLink(invite) {
  const payload = await encodeInvitePayload(invite);
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `join=${payload}`;
  return url.toString();
}

async function parseInvitePayload(encoded) {
  const invite = await decodeInvitePayload(encoded);
  if (!invite?.tracks?.length) {
    throw new Error("Invalid invite.");
  }
  invite.tracks = invite.tracks.map((track) =>
    toTrack({
      ...track,
      service: invite.host?.service || "unknown",
      id: "",
      uri: "",
      artworkUrl: "",
      url: "",
    }),
  );
  return invite;
}

async function encodeInvitePayload(invite) {
  const json = JSON.stringify(invite);
  if ("CompressionStream" in window) {
    const bytes = await gzip(json);
    return `gz.${base64UrlEncode(bytes)}`;
  }
  return `b64.${base64UrlEncode(new TextEncoder().encode(json))}`;
}

async function decodeInvitePayload(encoded) {
  const [format, payload] = encoded.split(".", 2);
  const bytes = base64UrlDecode(payload || "");
  if (format === "gz") {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser cannot open compressed spud links.");
    }
    return JSON.parse(await gunzip(bytes));
  }
  if (format === "b64") {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  throw new Error("Unknown invite format.");
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function toTrack(input) {
  const artists = Array.isArray(input.artists) && input.artists.length
    ? input.artists.map(cleanDisplay).filter(Boolean)
    : ["Unknown artist"];
  const title = cleanDisplay(input.title || "Untitled");
  const track = {
    service: input.service,
    id: input.id || "",
    uri: input.uri || "",
    title,
    artists,
    album: cleanDisplay(input.album || ""),
    durationMs: Number(input.durationMs || 0),
    isrc: cleanIsrc(input.isrc || ""),
    artworkUrl: input.artworkUrl || "",
    url: input.url || "",
    appleType: input.appleType || "library-songs",
    catalogId: input.catalogId || "",
  };
  track.norm = normalizeTrack(track);
  return track;
}

function normalizeTrack(track) {
  const titleAnalysis = normalizeTitle(track.title);
  const artistNames = track.artists.map(normalizeArtistName).filter(Boolean);
  const primaryArtist = artistNames[0] || "";
  const titleKey = titleAnalysis.title;
  return {
    title: titleKey,
    titleTokens: titleKey.split(" ").filter(Boolean),
    artists: artistNames,
    artistTokens: artistNames.join(" ").split(" ").filter(Boolean),
    primaryArtist,
    strictKey: `${titleKey}::${primaryArtist}`,
    titleKey,
    versionFlags: titleAnalysis.versionFlags,
  };
}

function normalizeTitle(title) {
  let value = basicNormalize(title);
  const versionFlags = new Set();

  value = value.replace(/\b(feat|featuring|ft)\.?\s+[^-()[\]{}]+/g, " ");
  value = value.replace(/\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/g, (_match, a, b, c) => {
    const text = basicNormalize(a || b || c || "");
    collectVersionFlags(text, versionFlags);
    if (isVersionText(text)) return " ";
    return ` ${text} `;
  });

  value = value.replace(/\s+-\s+([^-]+)$/g, (_match, suffix) => {
    const text = basicNormalize(suffix);
    collectVersionFlags(text, versionFlags);
    if (isVersionText(text)) return " ";
    return ` ${text}`;
  });

  collectVersionFlags(value, versionFlags);
  value = value
    .split(" ")
    .filter((word) => !VERSION_WORDS.has(word) && !looksLikeYear(word))
    .join(" ");

  return {
    title: collapseSpaces(value),
    versionFlags: [...versionFlags].sort(),
  };
}

function normalizeArtistName(name) {
  return basicNormalize(name)
    .replace(/\b(feat|featuring|ft|with|and)\b/g, " ")
    .replace(/\b(the)\b/g, " ")
    .split(" ")
    .filter(Boolean)
    .join(" ");
}

function basicNormalize(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9()[\]{}\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectVersionFlags(text, flags) {
  for (const word of text.split(/\s+/)) {
    if (PENALTY_VERSION_WORDS.has(word)) flags.add(word);
    if (word.startsWith("remix")) flags.add("remix");
  }
}

function isVersionText(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  return words.some((word) => VERSION_WORDS.has(word) || PENALTY_VERSION_WORDS.has(word) || looksLikeYear(word));
}

function looksLikeYear(word) {
  return /^(19|20)\d{2}$/.test(word);
}

function collapseSpaces(value) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanDisplay(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanIsrc(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function dedupeTracks(tracks) {
  const seen = new Map();
  for (const track of tracks) {
    const key = track.isrc ? `isrc:${track.isrc}` : `strict:${track.norm.strictKey}`;
    if (!seen.has(key)) {
      seen.set(key, track);
      continue;
    }

    const previous = seen.get(key);
    if (!previous.artworkUrl && track.artworkUrl) previous.artworkUrl = track.artworkUrl;
    if (!previous.url && track.url) previous.url = track.url;
    if (!previous.uri && track.uri) previous.uri = track.uri;
    if (!previous.id && track.id) previous.id = track.id;
  }
  return [...seen.values()];
}

function matchTracks(hostTracks, guestTracks) {
  const candidates = buildCandidateIndex(hostTracks);
  const matches = [];
  const usedHost = new Set();

  for (const guest of guestTracks) {
    const best = findBestMatch(guest, candidates, usedHost);
    if (!best) continue;
    usedHost.add(best.host._matchId);
    matches.push({
      hostTrack: best.host,
      yourTrack: guest,
      score: best.score,
      reason: best.reason,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.yourTrack.title.localeCompare(b.yourTrack.title));
}

function buildCandidateIndex(tracks) {
  const byIsrc = new Map();
  const byStrict = new Map();
  const byTitle = new Map();
  const byFirstToken = new Map();

  tracks.forEach((track, index) => {
    track._matchId = `${track.norm.strictKey}:${track.isrc}:${index}`;
    addToMap(byIsrc, track.isrc, track);
    addToMap(byStrict, track.norm.strictKey, track);
    addToMap(byTitle, track.norm.titleKey, track);
    addToMap(byFirstToken, track.norm.titleTokens[0] || "", track);
  });

  return { byIsrc, byStrict, byTitle, byFirstToken };
}

function findBestMatch(guest, index, usedHost) {
  if (guest.isrc) {
    const isrcMatch = firstUnused(index.byIsrc.get(guest.isrc), usedHost);
    if (isrcMatch) return { host: isrcMatch, score: 1, reason: "ISRC" };
  }

  const strictMatch = firstUnused(index.byStrict.get(guest.norm.strictKey), usedHost);
  if (strictMatch) return { host: strictMatch, score: 0.96, reason: "Title + artist" };

  const pool = uniqueTracks([
    ...(index.byTitle.get(guest.norm.titleKey) || []),
    ...(index.byFirstToken.get(guest.norm.titleTokens[0] || "") || []),
  ]).filter((track) => !usedHost.has(track._matchId));

  let best = null;
  for (const host of pool) {
    const score = scoreTracks(host, guest);
    if (!best || score.value > best.score) {
      best = { host, score: score.value, reason: score.reason };
    }
  }

  if (!best) return null;
  if (best.score >= 0.86) return best;
  return null;
}

function scoreTracks(a, b) {
  const titleScore = Math.max(
    diceCoefficient(a.norm.title, b.norm.title),
    jaccard(a.norm.titleTokens, b.norm.titleTokens),
  );
  const artistScore = Math.max(
    jaccard(a.norm.artistTokens, b.norm.artistTokens),
    diceCoefficient(a.norm.primaryArtist, b.norm.primaryArtist),
  );
  const durationScore = durationSimilarity(a.durationMs, b.durationMs);
  const penalty = versionPenalty(a.norm.versionFlags, b.norm.versionFlags);
  const value = clamp(titleScore * 0.6 + artistScore * 0.32 + durationScore * 0.08 - penalty, 0, 0.99);

  return {
    value,
    reason: titleScore > 0.95 ? "Nearly identical title" : "Fuzzy title + artist",
  };
}

function durationSimilarity(a, b) {
  if (!a || !b) return 0.6;
  const diff = Math.abs(a - b);
  if (diff < 2500) return 1;
  if (diff > 45000) return 0;
  return 1 - diff / 45000;
}

function versionPenalty(aFlags = [], bFlags = []) {
  const a = new Set(aFlags);
  const b = new Set(bFlags);
  let penalty = 0;
  for (const word of PENALTY_VERSION_WORDS) {
    if (a.has(word) !== b.has(word)) penalty += word === "remix" ? 0.14 : 0.1;
  }
  return penalty;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const aPairs = bigrams(a);
  const bPairs = bigrams(b);
  const counts = new Map();
  for (const pair of aPairs) counts.set(pair, (counts.get(pair) || 0) + 1);
  let intersection = 0;
  for (const pair of bPairs) {
    const count = counts.get(pair) || 0;
    if (count) {
      intersection += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * intersection) / (aPairs.length + bPairs.length);
}

function bigrams(value) {
  const compact = value.replace(/\s+/g, " ");
  const pairs = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    pairs.push(compact.slice(index, index + 2));
  }
  return pairs;
}

function jaccard(a = [], b = []) {
  const left = new Set(a.filter(Boolean));
  const right = new Set(b.filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / new Set([...left, ...right]).size;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function firstUnused(tracks = [], used) {
  return tracks.find((track) => !used.has(track._matchId));
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (seen.has(track._matchId)) return false;
    seen.add(track._matchId);
    return true;
  });
}

async function ensureAppleAuthorized() {
  await configureMusicKit();
  const music = window.MusicKit.getInstance();
  const existingToken = music.musicUserToken || sessionStorage.getItem(STORAGE.appleUserToken);
  if (existingToken) {
    sessionStorage.setItem(STORAGE.appleUserToken, existingToken);
    return music;
  }

  const userToken = await music.authorize();
  sessionStorage.setItem(STORAGE.appleUserToken, userToken || music.musicUserToken || "");
  return music;
}

function hasAppleTokenSource() {
  return Boolean(state.config.appleTokenEndpoint || state.config.appleDeveloperToken);
}

async function getAppleDeveloperToken() {
  if (state.config.appleDeveloperToken) {
    return state.config.appleDeveloperToken;
  }
  if (!state.config.appleTokenEndpoint) {
    throw new Error("Apple token endpoint is not configured.");
  }

  const response = await fetch(state.config.appleTokenEndpoint, {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.developerToken) {
    throw new Error(body.error || "Could not fetch Apple developer token.");
  }
  return body.developerToken;
}

async function resolveSpotifyPlaylistUris(accessToken) {
  const missing = [];
  const items = [];

  for (const match of state.matches) {
    const existing = [match.yourTrack, match.hostTrack].find((track) => track?.service === "spotify" && track.uri);
    if (existing?.uri) {
      items.push(existing.uri);
      continue;
    }

    const uri = await searchSpotifyTrack(accessToken, preferredTrack(match));
    if (uri) {
      items.push(uri);
    } else {
      missing.push(preferredTrack(match).title);
    }
  }

  return {
    items: uniqueValues(items),
    missing,
  };
}

async function searchSpotifyTrack(accessToken, reference) {
  const queries = [];
  if (reference.isrc) queries.push(`isrc:${reference.isrc}`);
  queries.push(`${reference.title} ${reference.artists[0] || ""}`);

  for (const query of queries) {
    const url = new URL("https://api.spotify.com/v1/search");
    url.search = new URLSearchParams({
      type: "track",
      limit: "5",
      q: query,
    }).toString();

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) continue;

    const best = (body.tracks?.items || [])
      .map((track) => {
        const candidate = toTrack({
          service: "spotify",
          id: track.id,
          uri: track.uri,
          title: track.name,
          artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
          album: track.album?.name || "",
          durationMs: track.duration_ms,
          isrc: track.external_ids?.isrc || "",
          artworkUrl: bestSpotifyImage(track.album?.images),
          url: track.external_urls?.spotify || "",
        });
        return {
          uri: candidate.uri,
          score: candidate.isrc && candidate.isrc === reference.isrc ? 1 : scoreTracks(candidate, reference).value,
        };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (best?.score >= 0.74) return best.uri;
  }

  return "";
}

async function resolveApplePlaylistTracks() {
  const missing = [];
  const items = [];

  for (const match of state.matches) {
    const existing = [match.yourTrack, match.hostTrack].find((track) => track?.service === "apple" && track.id);
    if (existing?.id) {
      items.push({
        id: existing.catalogId || existing.id,
        type: existing.catalogId ? "songs" : existing.appleType || "library-songs",
      });
      continue;
    }

    const result = await searchAppleTrack(preferredTrack(match));
    if (result) {
      items.push(result);
    } else {
      missing.push(preferredTrack(match).title);
    }
  }

  return {
    items: uniqueValues(items, (track) => `${track.type}:${track.id}`),
    missing,
  };
}

async function searchAppleTrack(reference) {
  const musicUserToken = sessionStorage.getItem(STORAGE.appleUserToken);
  const developerToken = await getAppleDeveloperToken();
  const url = new URL(`https://api.music.apple.com/v1/catalog/${state.config.appleStorefrontId || "us"}/search`);
  url.search = new URLSearchParams({
    types: "songs",
    limit: "5",
    term: `${reference.title} ${reference.artists[0] || ""}`,
  }).toString();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${developerToken}`,
      ...(musicUserToken ? { "Music-User-Token": musicUserToken } : {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return null;

  const best = (body.results?.songs?.data || [])
    .map((song) => {
      const candidate = toTrack({
        service: "apple",
        id: song.id,
        uri: song.id,
        title: song.attributes?.name,
        artists: splitAppleArtists(song.attributes?.artistName),
        album: song.attributes?.albumName || "",
        durationMs: song.attributes?.durationInMillis || 0,
        isrc: song.attributes?.isrc || "",
        artworkUrl: appleArtworkUrl(song.attributes?.artwork?.url),
        url: song.attributes?.url || "",
        appleType: "songs",
      });
      return {
        id: candidate.id,
        type: "songs",
        score: candidate.isrc && candidate.isrc === reference.isrc ? 1 : scoreTracks(candidate, reference).value,
      };
    })
    .sort((a, b) => b.score - a.score)[0];

  return best?.score >= 0.74 ? { id: best.id, type: best.type } : null;
}

function preferredTrack(match) {
  return match.yourTrack || match.hostTrack;
}

async function createPlaylist(targetService) {
  if (!state.matches.length) return;

  try {
    setBusy(true, `Planting in ${serviceName(targetService)}...`);
    if (targetService === "spotify") {
      if (!state.config.spotifyClientId) {
        throw new Error("Add a Spotify client ID in config.js before saving to Spotify.");
      }
      if (!sessionStorage.getItem(STORAGE.spotifyToken)) {
        saveAppSnapshot();
        await beginSpotifyAuth("export-spotify");
        return;
      }
      await createSpotifyPlaylist();
    } else if (targetService === "apple") {
      if (!hasAppleTokenSource()) {
        throw new Error("Add an Apple token endpoint before saving to Apple Music.");
      }
      await ensureAppleAuthorized();
      await createApplePlaylist();
    }
  } catch (error) {
    setStatus(error.message || "Could not plant that playlist.", "error");
  } finally {
    setBusy(false);
    render();
  }
}

async function createSpotifyPlaylist() {
  const accessToken = await getSpotifyAccessToken();
  const profile = await fetchSpotifyProfile(accessToken);
  const { items: uris, missing } = await resolveSpotifyPlaylistUris(accessToken);
  if (!uris.length) throw new Error("Spotify could not find any matching tracks.");

  const created = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(profile.id)}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: playlistName(),
      public: false,
      description: "Mashed together with Potatunes.",
    }),
  });
  const playlist = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(playlist.error?.message || "Spotify playlist creation failed.");

  for (const chunk of chunkArray(uris, 100)) {
    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/items`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: chunk }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "Spotify could not add tracks.");
  }

  const skipped = missing.length ? ` ${missing.length} tune${missing.length === 1 ? "" : "s"} could not be found.` : "";
  setStatus(`Planted ${uris.length} tune${uris.length === 1 ? "" : "s"} in Spotify.${skipped}`, "info");
}

async function createApplePlaylist() {
  const music = await ensureAppleAuthorized();
  const musicUserToken = music?.musicUserToken || sessionStorage.getItem(STORAGE.appleUserToken);
  if (!musicUserToken) throw new Error("Apple Music is not connected.");
  const developerToken = await getAppleDeveloperToken();

  const { items: tracks, missing } = await resolveApplePlaylistTracks();
  if (!tracks.length) throw new Error("Apple Music could not find any matching tracks.");

  const headers = {
    Authorization: `Bearer ${developerToken}`,
    "Music-User-Token": musicUserToken,
    "Content-Type": "application/json",
  };

  const created = await fetch("https://api.music.apple.com/v1/me/library/playlists", {
    method: "POST",
    headers,
    body: JSON.stringify({
      attributes: {
        name: playlistName(),
        description: "Mashed together with Potatunes.",
      },
    }),
  });
  const playlist = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(playlist.errors?.[0]?.detail || "Apple Music playlist creation failed.");

  const playlistId = playlist.data?.[0]?.id;
  if (!playlistId) throw new Error("Apple Music did not return a playlist ID.");

  for (const chunk of chunkArray(tracks, 100)) {
    const response = await fetch(`https://api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ data: chunk }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.errors?.[0]?.detail || "Apple Music could not add tracks.");
    }
  }

  const skipped = missing.length ? ` ${missing.length} tune${missing.length === 1 ? "" : "s"} could not be found.` : "";
  setStatus(`Planted ${tracks.length} tune${tracks.length === 1 ? "" : "s"} in Apple Music.${skipped}`, "info");
}

function playlistName() {
  return `Potatunes ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

async function copyInviteLink() {
  if (!state.shareLink) return;
  try {
    await navigator.clipboard.writeText(state.shareLink);
    setStatus("Spud link copied.", "info");
  } catch {
    els.inviteLink.select();
    document.execCommand("copy");
    setStatus("Spud link selected and copied.", "info");
  }
}

function downloadBlendPack() {
  if (!state.invite) return;
  downloadFile(
    "potatunes-sack.json",
    JSON.stringify(state.invite, null, 2),
    "application/json",
  );
}

async function importBlendPack(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const body = JSON.parse(await file.text());
    if (!body?.tracks?.length) throw new Error("Missing tracks.");
    state.invite = {
      ...body,
      tracks: body.tracks.map((track) =>
        toTrack({
          ...track,
          service: body.host?.service || "unknown",
        }),
      ),
    };
    state.matches = [];
    state.shareLink = "";
    sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(state.invite));
    if (state.session?.tracks?.length) {
      state.matches = matchTracks(state.invite.tracks, state.session.tracks);
      setStatus(`Sack imported. Found ${state.matches.length} shared tune${state.matches.length === 1 ? "" : "s"}.`, "info");
    } else {
      setStatus("Sack imported. Pick your app to mash it.", "info");
    }
    render();
  } catch {
    setStatus("That file was not a valid potato sack.", "error");
  }
}

function exportCsv() {
  if (!state.matches.length) return;
  const rows = [
    ["Title", "Artists", "Album", "Confidence", "Matched title", "Matched artists"],
    ...state.matches.map((match) => [
      match.yourTrack.title,
      match.yourTrack.artists.join(", "),
      match.yourTrack.album,
      Math.round(match.score * 100),
      match.hostTrack.title,
      match.hostTrack.artists.join(", "),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadFile("potatunes-results.csv", csv, "text/csv");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function loadDemo() {
  state.walkthroughIndex = null;
  const hostTracks = [
    ["Mash Potato Moonlight - Radio Edit", ["The Tater Tots"], "Couch Crop", 201000, "USPT10000001"],
    ["Gravy Groove", ["Yukon Golds"], "Boil Point", 185000, "USPT10000002"],
    ["Eyes on You (2018 Remaster)", ["The Spudniks"], "Window Sill", 218000, "USPT10000003"],
    ["Hot Potato", ["Noah Frye"], "Snack Time", 174000, "USPT10000004"],
    ["Couch Sprout", ["Ari Hash"], "Blanket Season", 206000, "USPT10000005"],
  ].map(([title, artists, album, durationMs, isrc]) =>
    toTrack({ service: "spotify", title, artists, album, durationMs, isrc }),
  );

  const guestTracks = [
    ["Mash Potato Moonlight", ["The Tater Tots"], "Couch Crop", 200000, "USPT10000001"],
    ["Eyes on You", ["Spudniks"], "Window Sill", 217000, "USPT10000003"],
    ["Hot Potato (Acoustic)", ["Noah Frye"], "Porch Fries", 178000, ""],
    ["Tiny Yam Jam", ["Jules Hash"], "Root Cellar", 194000, ""],
    ["Gravy Groove (feat. Rui)", ["Yukon Golds"], "Boil Point", 184000, "USPT10000002"],
  ].map(([title, artists, album, durationMs, isrc]) =>
    toTrack({ service: "apple", title, artists, album, durationMs, isrc, id: title, appleType: "library-songs" }),
  );

  state.invite = {
    v: 1,
    blendId: crypto.randomUUID?.() || randomString(24),
    createdAt: new Date().toISOString(),
    host: {
      name: "Sample Spotify spud",
      service: "spotify",
      sourceLabel: "Saved tracks",
      count: hostTracks.length,
    },
    tracks: hostTracks,
  };
  state.session = {
    service: "apple",
    profile: { name: "Sample Apple Music spud" },
    tracks: guestTracks,
  };
  state.matches = matchTracks(hostTracks, guestTracks);
  state.shareLink = await createShareLink({
    ...state.invite,
    tracks: hostTracks.map(compactTrackForInvite),
  });
  setStatus("Sample spuds loaded.", "info");
  render();
}

function clearSession() {
  sessionStorage.removeItem(STORAGE.spotifyToken);
  sessionStorage.removeItem(STORAGE.spotifyOAuth);
  sessionStorage.removeItem(STORAGE.pendingInvite);
  sessionStorage.removeItem(STORAGE.appleUserToken);
  sessionStorage.removeItem(STORAGE.appSnapshot);
  state.invite = null;
  state.session = null;
  state.matches = [];
  state.shareLink = "";
  state.walkthroughIndex = null;
  window.history.replaceState(null, "", window.location.pathname);
}

function goHome() {
  clearSession();
  els.statusLog.classList.add("hidden");
  render();
}

function resetSession() {
  clearSession();
  setStatus("Session reset.", "info");
  render();
}

function startWalkthrough() {
  clearSession();
  state.walkthroughIndex = 0;
  els.statusLog.classList.add("hidden");
  render();
}

function advanceWalkthrough() {
  if (state.walkthroughIndex === null) return;
  if (state.walkthroughIndex >= WALKTHROUGH_STEPS.length - 1) {
    loadDemo();
    return;
  }
  state.walkthroughIndex += 1;
  render();
}

function saveAppSnapshot() {
  sessionStorage.setItem(
    STORAGE.appSnapshot,
    JSON.stringify({
      invite: state.invite,
      session: state.session,
      shareLink: state.shareLink,
    }),
  );
}

function restoreAppSnapshot() {
  const snapshot = safeJsonParse(sessionStorage.getItem(STORAGE.appSnapshot));
  if (!snapshot) return;

  state.invite = snapshot.invite
    ? {
      ...snapshot.invite,
      tracks: (snapshot.invite.tracks || []).map((track) =>
        toTrack({ ...track, service: snapshot.invite.host?.service || track.service || "unknown" }),
      ),
    }
    : null;
  state.session = snapshot.session
    ? {
      ...snapshot.session,
      tracks: (snapshot.session.tracks || []).map((track) => toTrack(track)),
    }
    : null;
  state.shareLink = snapshot.shareLink || "";
  state.matches = state.invite && state.session ? matchTracks(state.invite.tracks, state.session.tracks) : [];
}

function render() {
  renderConfigBadge();
  renderModeBanner();
  renderPanels();
  renderWalkthrough();
  renderSteps();
  renderButtons();
  if (window.lucide) window.lucide.createIcons();
}

function renderConfigBadge() {
  const hasSpotify = Boolean(state.config.spotifyClientId);
  const hasApple = hasAppleTokenSource();
  els.configBadge.className = `status-pill ${hasSpotify && hasApple ? "ready" : "warning"}`;
  els.configBadge.textContent = hasSpotify && hasApple ? "Configured" : "Needs config";
}

function renderModeBanner() {
  if (!state.invite || state.session) {
    els.modeBanner.classList.add("hidden");
    return;
  }
  els.modeBanner.classList.remove("hidden");
  els.modeBanner.innerHTML = `<strong>${escapeHtml(state.invite.host?.name || "A friend")}</strong> wants to mash tunes with you.`;
}

function renderPanels() {
  const hasSession = Boolean(state.session);
  const hasInvite = Boolean(state.invite);
  const isWalking = state.walkthroughIndex !== null;
  const isHosting = Boolean(hasSession && state.shareLink && state.matches.length === 0);
  const isJoining = Boolean(hasSession && hasInvite && !state.shareLink);
  const collecting = state.busy && hasSession && !state.session.tracks.length;

  els.connectPanel.classList.toggle("hidden", hasSession || collecting || isWalking);
  els.libraryPanel.classList.toggle("hidden", !collecting);
  els.invitePanel.classList.toggle("hidden", !isHosting);
  els.resultsPanel.classList.toggle("hidden", !(isJoining || state.matches.length > 0));

  if (!hasSession) {
    els.connectTitle.textContent = hasInvite ? "Pick your music app" : "Pick your music app";
    els.connectCopy.textContent = hasInvite
      ? "We'll check what grew in both sacks."
      : "";
  }

  if (isHosting) renderInvitePanel();
  if (isJoining || state.matches.length > 0) renderResults();
}

function renderWalkthrough() {
  if (state.walkthroughIndex === null) {
    els.walkthroughPanel.classList.add("hidden");
    return;
  }

  const step = WALKTHROUGH_STEPS[state.walkthroughIndex];
  els.walkthroughPanel.classList.remove("hidden");
  els.walkthroughStep.textContent = `Step ${state.walkthroughIndex + 1} of ${WALKTHROUGH_STEPS.length}`;
  els.walkthroughTitle.textContent = step.title;
  els.walkthroughCopy.textContent = step.copy;
  els.walkthroughNextButton.textContent = step.button;
  els.walkthroughVisual.className = `walkthrough-scene ${step.scene}`;
}

function renderInvitePanel() {
  els.inviteCount.textContent = state.invite?.tracks?.length || 0;
  els.inviteLink.value = state.shareLink;
  const isLong = state.shareLink.length > 60000;
  els.linkWarning.classList.toggle("hidden", !isLong);
  if (isLong) {
    els.linkWarning.textContent =
      "This library made a very long link. Download a blend pack too; it is more reliable for large libraries.";
  }
}

function renderResults() {
  const matchCount = state.matches.length;
  els.matchCount.textContent = matchCount;
  els.resultTitle.textContent = matchCount
    ? `${matchCount} tune${matchCount === 1 ? "" : "s"} in the same sack`
    : "No shared spuds yet";
  els.resultCopy.textContent = matchCount
    ? "Plant the playlist where you want it."
    : "No musical potatoes overlapped this time.";

  const hostCount = state.invite?.tracks?.length || 0;
  const guestCount = state.session?.tracks?.length || 0;
  els.resultStats.innerHTML = [
    statHtml(hostCount, `${serviceName(state.invite?.host?.service)} potatoes`),
    statHtml(guestCount, `${serviceName(state.session?.service)} potatoes`),
    statHtml(matchCount, "Shared spuds"),
  ].join("");

  els.matchList.innerHTML = state.matches
    .slice(0, 120)
    .map((match) => matchRowHtml(match))
    .join("") || `<div class="notice">No matches found. Try exporting both libraries and reviewing titles manually.</div>`;
}

function statHtml(value, label) {
  return `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function matchRowHtml(match) {
  const track = match.yourTrack;
  const art = track.artworkUrl
    ? `<img src="${escapeAttribute(track.artworkUrl)}" alt="" loading="lazy" />`
    : "";
  return `
    <article class="match-row">
      <div class="match-art">${art}</div>
      <div class="match-copy">
        <strong>${escapeHtml(track.title)}</strong>
        <span>${escapeHtml(track.artists.join(", "))}${track.album ? ` &middot; ${escapeHtml(track.album)}` : ""}</span>
      </div>
      <span class="confidence">${Math.round(match.score * 100)}%</span>
    </article>
  `;
}

function renderSteps() {
  const hasSession = Boolean(state.session);
  const hasInvite = Boolean(state.invite);
  const hasBlend = state.matches.length > 0 || (hasInvite && hasSession && !state.shareLink);
  setStep(els.stepConnect, hasSession ? "done" : "active");
  setStep(els.stepCollect, hasSession ? (hasBlend || state.shareLink ? "done" : "active") : "");
  setStep(els.stepBlend, hasBlend || state.shareLink ? "active" : "");
}

function setStep(el, status) {
  el.classList.remove("active", "done");
  if (status) el.classList.add(status);
}

function renderButtons() {
  const disabled = state.busy;
  [
    els.appleButton,
    els.spotifyButton,
    els.demoButton,
    els.homeButton,
    els.importButton,
    els.copyInviteButton,
    els.downloadPackButton,
    els.exportCsvButton,
    els.spotifyExportButton,
    els.appleExportButton,
    els.walkthroughNextButton,
    els.walkthroughCloseButton,
  ].forEach((button) => {
    button.disabled = disabled;
  });

  els.copyInviteButton.disabled = disabled || !state.shareLink;
  els.downloadPackButton.disabled = disabled || !state.invite;
  els.exportCsvButton.disabled = disabled || !state.matches.length;
  els.spotifyExportButton.disabled = disabled || !state.matches.length;
  els.appleExportButton.disabled = disabled || !state.matches.length;
}

function renderCollecting(serviceNameText, count, total) {
  els.connectPanel.classList.add("hidden");
  els.libraryPanel.classList.remove("hidden");
  els.resultsPanel.classList.add("hidden");
  els.invitePanel.classList.add("hidden");
  els.libraryTitle.textContent = `Reading ${serviceNameText}`;
  updateLibraryProgress(count, total);
  render();
}

function updateLibraryProgress(count, total) {
  els.libraryCounter.textContent = String(count);
  els.libraryCopy.textContent = total > count ? `${count} of about ${total} tunes dug up.` : `${count} tunes dug up.`;
  const pct = total ? clamp((count / total) * 100, 8, 100) : 12;
  els.progressFill.style.width = `${pct}%`;
  renderArtworkPreview(state.session?.tracks || []);
}

function renderArtworkPreview(tracks) {
  const artwork = tracks.map((track) => track.artworkUrl).filter(Boolean).slice(-8);
  if (!artwork.length) {
    els.sampleArtwork.innerHTML = Array.from({ length: 8 }, () => `<span class="art-placeholder"></span>`).join("");
    return;
  }
  els.sampleArtwork.innerHTML = artwork
    .map((url) => `<img src="${escapeAttribute(url)}" alt="" loading="lazy" />`)
    .join("");
}

function setBusy(value, message) {
  state.busy = value;
  if (message) setStatus(message, "info");
  renderButtons();
}

function setStatus(message, type = "info") {
  els.statusLog.classList.remove("hidden");
  els.statusLog.textContent = message;
  els.statusLog.style.borderColor = type === "error" ? "rgba(239, 111, 97, 0.34)" : "rgba(78, 181, 140, 0.28)";
  els.statusLog.style.background = type === "error" ? "rgba(239, 111, 97, 0.1)" : "rgba(78, 181, 140, 0.09)";
  els.statusLog.style.color = type === "error" ? "#9b372e" : "#275d4a";
}

function serviceName(service) {
  return SERVICES[service]?.name || "Music";
}

function randomString(length) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (value) => charset[value % charset.length]).join("");
}

async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("MusicKit did not load. Check the network connection."));
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueValues(items, keyFn = (item) => item) {
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
