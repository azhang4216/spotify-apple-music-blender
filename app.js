const STORAGE = {
  spotifyToken: "potatunes.spotifyToken",
  spotifyOAuth: "potatunes.spotifyOAuth",
  potatunesAuth: "potatunes.auth",
  pendingInvite: "potatunes.pendingInvite",
  pendingInvitePayload: "potatunes.pendingInvitePayload",
  appleUserToken: "potatunes.appleUserToken",
  appleDisplayName: "potatunes.appleDisplayName",
  appSnapshot: "potatunes.appSnapshot",
  blendHistory: "potatunes.blendHistory",
};

const DEFAULT_CONFIG = {
  appName: "Potatunes",
  appBuild: "1.0.0",
  spotifyClientId: "",
  spotifyRedirectUri: "",
  appleDeveloperToken: "",
  appleTokenEndpoint: "",
  apiBase: "",
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
const RESULTS_PAGE_SIZE = 40;
const LIBRARY_REFRESH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const APPLE_PAGE_SIZE = 100;
const APPLE_PLACEHOLDER_NAME = "Apple Music listener";

const state = {
  config: { ...DEFAULT_CONFIG },
  invite: null,
  session: null,
  matches: [],
  busy: false,
  shareLink: "",
  myInvite: null,
  myShareLink: "",
  blendHistory: [],
  activeBlend: null,
  resultPage: 1,
  potatunesAuth: null,
  invitePayload: "",
  readyToMash: false,
  mashComplete: false,
  welcomeBack: false,
  loading: defaultLoadingState(),
};

const LOADING_STEPS = [
  { id: "yourSongs", label: "finding your songs" },
  { id: "spuddySongs", label: "finding your spuddy's songs" },
  { id: "mash", label: "mashing the potato overlaps" },
  { id: "generate", label: "generating" },
];

const els = {};
let pendingNamePrompt = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  state.blendHistory = loadBlendHistory();
  state.potatunesAuth = loadPotatunesAuth();
  await loadExternalConfig();
  loadConfig();
  attachEvents();
  await loadRouteFromLocation();

  const handledSpotifyCallback = await handleSpotifyCallback();
  if (!handledSpotifyCallback) {
    render();
  }
}

function bindElements() {
  [
    "accountPanel",
    "accountSummary",
    "appleButton",
    "blendHistoryList",
    "blendFlow",
    "configBadge",
    "connectPanel",
    "copyInviteButton",
    "copyMyInviteButton",
    "downloadPackButton",
    "exportCsvButton",
    "homeButton",
    "importButton",
    "importFile",
    "inviteIntro",
    "inviteIntroCopy",
    "inviteIntroTitle",
    "inviteCopy",
    "inviteCount",
    "inviteLink",
    "invitePanel",
    "libraryCopy",
    "libraryCounter",
    "libraryPanel",
    "libraryTitle",
    "linkWarning",
    "logoutButton",
    "matchCount",
    "matchList",
    "mashButton",
    "modeBanner",
    "nameForm",
    "nameInput",
    "nameModal",
    "nameSaveButton",
    "progressFill",
    "resetButton",
    "resultCopy",
    "resultNextButton",
    "resultPageLabel",
    "resultPager",
    "resultPrevButton",
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
    "topAccount",
    "verifiedCopy",
    "verifiedPanel",
    "verifiedTitle",
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
  if (!state.config.apiBase && state.config.appleTokenEndpoint) {
    try {
      state.config.apiBase = new URL(state.config.appleTokenEndpoint).origin;
    } catch {
      state.config.apiBase = "";
    }
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
  els.homeButton.addEventListener("click", goHome);
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importBlendPack);
  els.copyInviteButton.addEventListener("click", copyInviteLink);
  els.downloadPackButton.addEventListener("click", downloadBlendPack);
  els.exportCsvButton.addEventListener("click", exportCsv);
  els.spotifyExportButton.addEventListener("click", () => createPlaylist("spotify"));
  els.appleExportButton.addEventListener("click", () => createPlaylist("apple"));
  els.resetButton.addEventListener("click", goHome);
  els.copyMyInviteButton.addEventListener("click", copyMyInviteLink);
  els.mashButton.addEventListener("click", mashInvite);
  els.logoutButton.addEventListener("click", logout);
  els.blendHistoryList.addEventListener("click", openBlendHistory);
  els.resultPrevButton.addEventListener("click", () => changeResultPage(-1));
  els.resultNextButton.addEventListener("click", () => changeResultPage(1));
  els.nameForm.addEventListener("submit", submitNamePrompt);
  window.addEventListener("hashchange", () => {
    if (state.busy) return;
    loadRouteFromLocation({ fromNavigation: true }).then(() => render());
  });
}

async function loadRouteFromLocation({ fromNavigation = false } = {}) {
  const route = parseCurrentRoute();

  if (fromNavigation && route.screen === "home") {
    clearSession();
    return;
  }

  if (route.screen === "mash" && route.mashId) {
    await openBlendById(route.mashId, { navigate: false });
    return;
  }

  if (!route.payload) {
    const pending = sessionStorage.getItem(STORAGE.pendingInvite);
    if (pending) {
      state.invite = safeJsonParse(pending);
      state.invitePayload = sessionStorage.getItem(STORAGE.pendingInvitePayload) || "";
    }
    return;
  }

  try {
    const invite = await parseInvitePayload(route.payload);
    state.invite = invite;
    state.invitePayload = route.payload;
    state.shareLink = "";
    state.activeBlend = null;
    if (state.session && await returnHomeForOwnInvite()) return;
    if (route.screen === "results" && state.session?.tracks?.length) {
      state.matches = matchTracks(state.invite.tracks, state.session.tracks);
      state.readyToMash = false;
      state.mashComplete = true;
    } else {
      state.matches = [];
      state.readyToMash = Boolean(state.session?.tracks?.length);
      state.mashComplete = false;
    }
    sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(invite));
    sessionStorage.setItem(STORAGE.pendingInvitePayload, route.payload);
    normalizeRoute();
  } catch {
    setStatus("That spud link could not be opened. Try importing a sack instead.", "error");
  }
}

function parseCurrentRoute() {
  const rawHash = window.location.hash.replace(/^#/, "");
  if (!rawHash || rawHash === "/") return { screen: "home", payload: "" };

  if (rawHash.startsWith("join=")) {
    const params = new URLSearchParams(rawHash);
    return { screen: "join", payload: params.get("join") || "" };
  }

  const route = rawHash.startsWith("/") ? rawHash : `/${rawHash}`;
  const parts = route.split("/").filter(Boolean);
  if (parts[0] === "mash" && parts[1]) return { screen: "mash", mashId: parts[1], payload: "" };
  if (parts[0] === "spuddies" && parts[1]) {
    return {
      screen: parts[2] || "join",
      payload: parts[1],
    };
  }
  if (parts[0] === "share") return { screen: "share", payload: "" };
  if (parts[0] === "results") return { screen: "results", payload: "" };
  return { screen: "home", payload: "" };
}

function normalizeRoute() {
  const next = routeForState();
  setRoute(next, { replace: true });
}

function routeForState() {
  if (state.activeBlend) return `/mash/${encodeURIComponent(state.activeBlend.id)}`;

  const inviteRoute = inviteRoutePath();
  if (state.busy && state.loading.active) {
    return inviteRoute && state.session ? `${inviteRoute}/mashing` : "/loading";
  }
  if (state.invite && !state.session) return inviteRoute || "/spuddies";
  if (state.readyToMash && state.invite && state.session) return inviteRoute ? `${inviteRoute}/verified` : "/verified";
  if (state.mashComplete && state.invite && state.session && !state.shareLink) {
    return inviteRoute ? `${inviteRoute}/results` : "/results";
  }
  if (state.matches.length > 0) return "/results";
  if (state.session) return "/account";
  if (state.shareLink) return "/share";
  return "/";
}

function inviteRoutePath(payload = state.invitePayload) {
  return payload ? `/spuddies/${payload}` : "";
}

function setRoute(route, { replace = true } = {}) {
  const hash = route.startsWith("/") ? route : `/${route}`;
  const nextUrl = `${window.location.pathname}#${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", nextUrl);
}

async function connectService(service) {
  if (state.busy) return;

  if (service === "spotify") {
    const returningUser = hasPriorServiceSession("spotify");
    if (!state.config.spotifyClientId) {
      setStatus("Potatunes setup is not finished yet. Check Spotify and Cloudflare setup.", "error");
      return;
    }
    sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(state.invite));
    if (state.invitePayload) sessionStorage.setItem(STORAGE.pendingInvitePayload, state.invitePayload);
    if (getStoredItem(STORAGE.spotifyToken)) {
      try {
        setBusy(true);
        await finishSpotifyConnection({ returning: returningUser });
        return;
      } catch {
        removeStoredItem(STORAGE.spotifyToken);
      } finally {
        setBusy(false);
        render();
      }
    }
    await beginSpotifyAuth("collect");
    return;
  }

  if (!hasAppleTokenSource()) {
    setStatus("Potatunes setup is not finished yet. Check the Cloudflare token worker.", "error");
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
      returningUser: hasPriorServiceSession("spotify"),
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
  state.invitePayload = sessionStorage.getItem(STORAGE.pendingInvitePayload) || state.invitePayload;
  state.potatunesAuth = loadPotatunesAuth();

  try {
    const returningUser = Boolean(oauth.returningUser);
    setBusy(true, returningUser ? "Logging you back in..." : "Finishing Spotify sign-in...");
    const token = await exchangeSpotifyCode(code, oauth);
    saveSpotifyToken(token);
    if (oauth.action === "export-spotify") {
      restoreAppSnapshot();
      await createSpotifyPlaylist();
    } else {
      await finishSpotifyConnection({ returning: returningUser });
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
  setStoredItem(
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
  const token = safeJsonParse(getStoredItem(STORAGE.spotifyToken));
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
  setStoredItem(STORAGE.spotifyToken, JSON.stringify(nextToken));
  return nextToken.accessToken;
}

async function finishSpotifyConnection({ returning = false } = {}) {
  state.welcomeBack = returning;
  state.session = {
    service: "spotify",
    profile: { name: "Spotify listener" },
    tracks: [],
  };
  renderCollecting("Spotify", 0, 4, {
    title: returning ? "Logging you back in..." : "Finding your songs",
    copy: returning ? "Checking your saved potato sack." : undefined,
  });

  const accessToken = await getSpotifyAccessToken();
  state.session.profile = await fetchSpotifyProfile(accessToken);
  await connectPotatunesSpotify(accessToken);
  if (await useStoredLibrarySnapshotIfFresh()) {
    await finishCollection();
    return;
  }
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
    avatarUrl: bestSpotifyImage(body.images),
    url: body.external_urls?.spotify,
  };
}

async function connectPotatunesSpotify(accessToken) {
  if (!apiBase()) return null;
  try {
    const body = await apiRequest("/api/auth/spotify", {
      method: "POST",
      body: { accessToken },
    });
    return savePotatunesAuth(body);
  } catch {
    return null;
  }
}

async function connectPotatunesApple(musicUserToken) {
  if (!apiBase() || !musicUserToken) return null;
  try {
    const savedDisplayName = cleanDisplay(getStoredItem(STORAGE.appleDisplayName));
    const body = await apiRequest("/api/auth/apple", {
      method: "POST",
      body: {
        musicUserToken,
        displayName: savedDisplayName || state.session?.profile?.name || APPLE_PLACEHOLDER_NAME,
      },
    });
    return savePotatunesAuth(body);
  } catch {
    return null;
  }
}

async function ensureAppleDisplayName() {
  if (state.session?.service !== "apple") return;

  const currentName = state.potatunesAuth?.user?.provider === "apple"
    ? state.potatunesAuth.user.displayName
    : state.session.profile?.name || "";
  if (!isPlaceholderAppleName(currentName)) {
    state.session.profile.name = currentName;
    setStoredItem(STORAGE.appleDisplayName, currentName);
    return;
  }

  const displayName = await requestNamePrompt();
  state.session.profile.name = displayName;
  setStoredItem(STORAGE.appleDisplayName, displayName);

  if (state.potatunesAuth?.user?.provider === "apple" && state.potatunesAuth?.session?.token && apiBase()) {
    try {
      const body = await apiRequest("/api/me", {
        method: "PATCH",
        auth: true,
        body: { displayName },
      });
      if (body.user) {
        savePotatunesAuth({
          ...state.potatunesAuth,
          user: body.user,
        });
        state.session.profile.name = body.user.displayName || displayName;
      }
    } catch {
      // The local nickname still works for this browser if the backend is unavailable.
    }
  }
}

function isPlaceholderAppleName(name) {
  return !cleanDisplay(name) || cleanDisplay(name) === APPLE_PLACEHOLDER_NAME;
}

function requestNamePrompt() {
  return new Promise((resolve) => {
    pendingNamePrompt = resolve;
    els.nameInput.value = cleanDisplay(getStoredItem(STORAGE.appleDisplayName));
    els.nameModal.classList.remove("hidden");
    window.setTimeout(() => els.nameInput.focus(), 0);
  });
}

function submitNamePrompt(event) {
  event.preventDefault();
  const displayName = cleanDisplay(els.nameInput.value).slice(0, 40);
  if (!displayName) return;
  els.nameModal.classList.add("hidden");
  const resolve = pendingNamePrompt;
  pendingNamePrompt = null;
  resolve?.(displayName);
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
  const returningUser = hasPriorServiceSession("apple");
  try {
    setBusy(true, returningUser ? "Logging you back in..." : "Opening Apple Music...");
    await configureMusicKit();
    const music = window.MusicKit.getInstance();
    const storedToken = getStoredItem(STORAGE.appleUserToken);
    if (storedToken && !music.musicUserToken) {
      try {
        music.musicUserToken = storedToken;
      } catch {
        // MusicKit owns this value in some browsers.
      }
    }
    const userToken = music.musicUserToken || storedToken || await music.authorize();
    setStoredItem(STORAGE.appleUserToken, userToken || music.musicUserToken || "");

    state.session = {
      service: "apple",
      profile: { name: cleanDisplay(getStoredItem(STORAGE.appleDisplayName)) || APPLE_PLACEHOLDER_NAME },
      tracks: [],
    };
    state.welcomeBack = returningUser;
    const auth = await connectPotatunesApple(userToken || music.musicUserToken || "");
    if (auth?.user?.displayName) state.session.profile.name = auth.user.displayName;
    await ensureAppleDisplayName();
    renderCollecting("Apple Music", 0, 4, {
      title: returningUser ? "Logging you back in..." : "Finding your songs",
      copy: returningUser ? "Checking your saved potato sack." : undefined,
    });
    if (await useStoredLibrarySnapshotIfFresh()) {
      await finishCollection();
      return;
    }
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
  const musicKitTracks = await fetchAppleLibrarySongsWithMusicKit(music).catch(() => []);
  if (musicKitTracks.length) return musicKitTracks;

  const apiTracks = await fetchAppleLibrarySongsWithApi().catch(() => []);
  if (apiTracks.length) return apiTracks;

  return await fetchAppleFavoritePlaylistTracks().catch(() => []);
}

async function fetchAppleLibrarySongsWithMusicKit(music) {
  const tracks = [];
  const limit = APPLE_PAGE_SIZE;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await music.api.library.songs({ limit, offset });
    const data = response?.data || [];
    for (const song of data) {
      tracks.push(appleSongResourceToTrack(song));
    }

    if (state.session?.service === "apple") state.session.tracks = tracks;
    updateLibraryProgress(tracks.length, response?.meta?.total || tracks.length + (data.length === limit ? limit : 0));
    offset += limit;
    hasMore = data.length === limit;
  }

  return tracks;
}

async function fetchAppleLibrarySongsWithApi() {
  return await fetchAppleTrackPageSet("/v1/me/library/songs");
}

async function fetchAppleFavoritePlaylistTracks() {
  const playlists = await fetchAppleLibraryPlaylists();
  const favoritePlaylist = playlists.find(isFavoriteSongsPlaylist);
  if (!favoritePlaylist) return [];

  const tracks = await fetchAppleTrackPageSet(`/v1/me/library/playlists/${encodeURIComponent(favoritePlaylist.id)}/tracks`);
  if (tracks.length) {
    setStatus("Apple Music returned your Favorite Songs playlist. Using that sack.", "info");
  }
  return tracks;
}

async function fetchAppleLibraryPlaylists() {
  const playlists = [];
  await fetchApplePaged("/v1/me/library/playlists", (playlist) => playlists.push(playlist));
  return playlists;
}

async function fetchAppleTrackPageSet(path) {
  const tracks = [];
  await fetchApplePaged(path, (song) => {
    tracks.push(appleSongResourceToTrack(song));
    if (state.session?.service === "apple") state.session.tracks = tracks;
    updateLibraryProgress(tracks.length, tracks.length + APPLE_PAGE_SIZE);
  });
  updateLibraryProgress(tracks.length, tracks.length);
  return tracks;
}

async function fetchApplePaged(path, onItem) {
  let next = path;
  let params = { limit: String(APPLE_PAGE_SIZE), offset: "0" };

  while (next) {
    const body = await fetchAppleApi(next, params);
    for (const item of body.data || []) onItem(item);
    next = body.next || "";
    params = {};
  }
}

async function fetchAppleApi(path, params = {}) {
  const musicUserToken = getStoredItem(STORAGE.appleUserToken);
  if (!musicUserToken) throw new Error("Apple Music is not connected.");

  const developerToken = await getAppleDeveloperToken();
  const url = new URL(path, "https://api.music.apple.com");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${developerToken}`,
      "Music-User-Token": musicUserToken,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.errors?.[0]?.detail || body.errors?.[0]?.title || "Apple Music request failed.");
  }
  return body;
}

function appleSongResourceToTrack(song) {
  const attributes = song.attributes || {};
  return toTrack({
    service: "apple",
    id: song.id,
    uri: song.id,
    title: attributes.name,
    artists: splitAppleArtists(attributes.artistName),
    album: attributes.albumName || "",
    durationMs: attributes.durationInMillis || 0,
    isrc: attributes.isrc || "",
    artworkUrl: appleArtworkUrl(attributes.artwork?.url),
    url: attributes.url || "",
    appleType: song.type || "library-songs",
    catalogId: attributes.playParams?.catalogId || (song.type === "songs" ? song.id : ""),
  });
}

function isFavoriteSongsPlaylist(playlist) {
  const name = basicNormalize(playlist.attributes?.name || "");
  return name === "favorite songs" || name === "favourite songs";
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

  const userToken = music.musicUserToken || getStoredItem(STORAGE.appleUserToken);
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

    setStatus(`Apple Music found ${likedIds.size} liked tunes. Using those.`, "info");
    return tracks.filter((track) => likedIds.has(track.id));
  } catch {
    return tracks;
  }
}

async function finishCollection() {
  if (!state.session?.tracks?.length) {
    const isApple = state.session?.service === "apple";
    state.readyToMash = false;
    state.mashComplete = false;
    markLoadingStepDone("yourSongs", {
      title: "No songs found",
      copy: isApple ? "Apple returned no library or Favorite Songs tracks." : "Nothing turned up in this sack.",
      counter: "0",
    });
    setStatus(
      isApple
        ? "Apple Music returned no library or Favorite Songs tracks for this account."
        : "No tunes were found for this account.",
      "error",
    );
    return;
  }

  markLoadingStepDone("yourSongs", {
    copy: `${state.session.tracks.length} tunes dug up.`,
    counter: String(state.session.tracks.length),
  });
  await waitForPaint();

  if (await returnHomeForOwnInvite()) return;

  if (state.invite) {
    if (!state.invite.tracks?.length && state.invite.slug) {
      setLoadingProgress("spuddySongs", 48, {
        title: "Finding your spuddy's songs",
        copy: "Opening the shared potato link.",
        counter: "...",
        showArtwork: false,
      });
      await waitForPaint();
      state.invite = await fetchShortInvite(state.invite.slug, { includeTracks: true });
      sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(state.invite));
      markLoadingStepDone("spuddySongs", {
        copy: `${state.invite.tracks.length} spuddy tunes ready.`,
        counter: String(state.invite.tracks.length),
        showArtwork: false,
      });
      await waitForPaint();
    }
    state.matches = [];
    state.activeBlend = null;
    state.shareLink = "";
    state.readyToMash = true;
    state.mashComplete = false;
    els.statusLog.classList.add("hidden");
    return;
  }

  state.readyToMash = false;
  state.mashComplete = false;
  setLoadingProgress("generate", 36, {
    title: "Generating",
    copy: "Packing your potato link.",
    counter: "...",
    showArtwork: false,
  });
  await waitForPaint();
  const invite = await ensureMyInviteLink();
  state.invite = invite;
  sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(invite));
  state.shareLink = state.myShareLink;
  await refreshBlendHistory();
  markLoadingStepDone("generate", {
    copy: "Spud link ready.",
    counter: String(state.session.tracks.length),
    showArtwork: false,
  });
  setStatus("Spud link ready.", "info");
}

async function mashInvite() {
  if (state.busy || !state.invite || !state.session?.tracks?.length) return;
  if (await returnHomeForOwnInvite()) {
    render();
    return;
  }

  try {
    state.readyToMash = false;
    state.mashComplete = false;
    state.matches = [];
    setBusy(true);
    startLoadingFlow("yourSongs", {
      title: "Finding your songs",
      copy: `${state.session.tracks.length} tunes ready.`,
      counter: String(state.session.tracks.length),
      progress: 72,
      steps: ["yourSongs", "spuddySongs", "mash", "generate"],
      showArtwork: false,
    });
    await waitForPaint();
    markLoadingStepDone("yourSongs", {
      copy: `${state.session.tracks.length} tunes ready.`,
      counter: String(state.session.tracks.length),
      showArtwork: false,
    });
    markLoadingStepDone("spuddySongs", {
      title: "Finding your spuddy's songs",
      copy: `${state.invite.tracks.length} spuddy tunes ready.`,
      counter: String(state.invite.tracks.length),
      showArtwork: false,
    });
    await waitForPaint();
    setLoadingProgress("mash", 38, {
      title: "Mashing overlaps",
      copy: "Squishing the shared favorites.",
      counter: "...",
      showArtwork: false,
    });
    await waitForPaint();

    state.matches = matchTracks(state.invite.tracks, state.session.tracks);
    state.activeBlend = null;
    state.resultPage = 1;
    state.mashComplete = true;
    markLoadingStepDone("mash", {
      copy: `${state.matches.length} overlaps mashed.`,
      counter: String(state.matches.length),
      showArtwork: false,
    });
    setLoadingProgress("generate", 60, {
      title: "Generating",
      copy: "Warming up the playlist.",
      counter: String(state.matches.length),
      showArtwork: false,
    });
    const backendBlend = await saveBackendBlendIfPossible();
    if (backendBlend) {
      activateApiBlend(backendBlend);
    }
    saveCurrentBlendHistory();
    await refreshBlendHistory();
    markLoadingStepDone("generate", {
      copy: "Mash ready.",
      counter: String(state.matches.length),
      showArtwork: false,
    });
    setStatus(`Found ${state.matches.length} shared tune${state.matches.length === 1 ? "" : "s"}.`, "info");
  } catch (error) {
    state.readyToMash = true;
    state.mashComplete = false;
    setStatus(error.message || "Could not mash those playlists.", "error");
  } finally {
    setBusy(false);
    render();
  }
}

function createInviteFromSession() {
  return {
    v: 1,
    blendId: crypto.randomUUID?.() || randomString(24),
    createdAt: new Date().toISOString(),
    host: {
      userId: state.potatunesAuth?.user?.id || "",
      name: state.session.profile?.name || `${SERVICES[state.session.service].name} listener`,
      service: state.session.service,
      avatarUrl: state.session.profile?.avatarUrl || "",
      sourceLabel: SERVICES[state.session.service].sourceLabel,
      count: state.session.tracks.length,
    },
    tracks: state.session.tracks.map(compactTrackForInvite),
  };
}

async function ensureMyInviteLink() {
  if (state.myInvite && state.myShareLink) return state.myInvite;
  if (!state.session?.tracks?.length) {
    throw new Error("Log in before copying an invite link.");
  }

  state.myInvite = createInviteFromSession();
  const shortInvite = await createShortShareLink(state.myInvite);
  if (shortInvite) {
    state.myInvite = shortInvite.invite;
    state.myShareLink = shortInvite.link;
    state.invitePayload = shortInvite.invite.slug;
    return state.myInvite;
  }

  state.myShareLink = await createShareLink(state.myInvite);
  return state.myInvite;
}

function compactTrackForInvite(track) {
  const norm = track.norm || normalizeTrack(track);
  return {
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    normTitle: norm.title,
    normArtists: norm.artists,
    primaryArtist: norm.primaryArtist,
    strictKey: norm.strictKey,
    titleKey: norm.titleKey,
    versionFlags: norm.versionFlags,
  };
}

function compactTrackForSnapshot(track) {
  const norm = track.norm || normalizeTrack(track);
  return {
    service: track.service,
    id: track.id,
    uri: track.uri,
    providerTrackDbId: track.providerTrackDbId || "",
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    artworkUrl: track.artworkUrl,
    url: track.url,
    appleType: track.appleType,
    catalogId: track.catalogId,
    normTitle: norm.title,
    normArtists: norm.artists,
    primaryArtist: norm.primaryArtist,
    strictKey: norm.strictKey,
    titleKey: norm.titleKey,
    versionFlags: norm.versionFlags,
  };
}

async function createShortShareLink(invite) {
  if (!state.potatunesAuth?.session?.token || !apiBase()) return null;

  try {
    const snapshot = await createLibrarySnapshotForSession();
    const inviteBody = await apiRequest("/api/invites", {
      method: "POST",
      auth: true,
      body: {
        ownerSnapshotId: snapshot.id,
      },
    });
    const slug = inviteBody.invite.slug;
    return {
      invite: {
        ...invite,
        v: 2,
        blendId: inviteBody.invite.id,
        slug,
        short: true,
      },
      link: routeLink(`/spuddies/${slug}`),
    };
  } catch {
    return null;
  }
}

async function createLibrarySnapshotForSession() {
  if (state.session?.librarySnapshot && isLibrarySnapshotFresh(state.session.librarySnapshot)) {
    return state.session.librarySnapshot;
  }

  const body = await apiRequest("/api/library-snapshots", {
    method: "POST",
    auth: true,
    body: {
      provider: state.session.service,
      sourceLabel: SERVICES[state.session.service].sourceLabel,
      tracks: state.session.tracks.map(compactTrackForSnapshot),
    },
  });
  state.session.librarySnapshot = body.snapshot;
  return body.snapshot;
}

async function useStoredLibrarySnapshotIfFresh() {
  const snapshot = await fetchLatestLibrarySnapshot({ includeTracks: true }).catch(() => null);
  if (!snapshot?.tracks?.length || !isLibrarySnapshotFresh(snapshot)) return false;

  state.session.librarySnapshot = snapshot;
  state.session.tracks = dedupeTracks(snapshot.tracks.map(trackFromSnapshot));
  renderCollecting(serviceName(state.session.service), state.session.tracks.length, state.session.tracks.length);
  markLoadingStepDone("yourSongs", {
    copy: `${state.session.tracks.length} tunes loaded from your saved sack.`,
    counter: String(state.session.tracks.length),
    showArtwork: false,
  });
  await waitForPaint();
  return true;
}

async function fetchLatestLibrarySnapshot({ includeTracks = false } = {}) {
  if (!state.potatunesAuth?.user?.id || !state.potatunesAuth?.session?.token || !apiBase()) return null;
  const query = includeTracks ? "?tracks=true" : "";
  const body = await apiRequest(`/api/users/${encodeURIComponent(state.potatunesAuth.user.id)}/library-snapshot${query}`, {
    auth: true,
  });
  return body.snapshot || null;
}

function isLibrarySnapshotFresh(snapshot) {
  const createdAt = Date.parse(snapshot?.createdAt || "");
  return Number.isFinite(createdAt) && Date.now() - createdAt < LIBRARY_REFRESH_COOLDOWN_MS;
}

function trackFromSnapshot(track) {
  return toTrack({
    ...track,
    service: track.provider || state.session?.service || "unknown",
    id: track.providerTrackId || track.id,
    uri: track.uri,
    providerTrackDbId: track.id || "",
    artworkUrl: track.artworkUrl || "",
    url: track.url || "",
  });
}

async function createShareLink(invite) {
  const payload = await encodeInvitePayload(invite);
  const link = routeLink(`/spuddies/${payload}`);
  if (
    invite.blendId &&
    (invite.blendId === state.invite?.blendId || (!state.invite && invite.blendId === state.myInvite?.blendId))
  ) {
    state.invitePayload = payload;
  }
  return link;
}

async function parseInvitePayload(encoded) {
  if (!isEncodedInvitePayload(encoded)) {
    return await fetchShortInvite(encoded, { includeTracks: Boolean(state.potatunesAuth?.session?.token) });
  }

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

function isEncodedInvitePayload(value) {
  return value.startsWith("gz.") || value.startsWith("b64.");
}

async function fetchShortInvite(slug, { includeTracks = false } = {}) {
  const query = includeTracks ? "?tracks=true" : "";
  const body = await apiRequest(`/api/invites/${encodeURIComponent(slug)}${query}`, {
    auth: includeTracks,
  });
  return normalizeApiInvite(body.invite, { includeTracks });
}

function normalizeApiInvite(invite, { includeTracks = false } = {}) {
  if (!invite?.slug) throw new Error("Invalid invite.");
  const hostService = invite.owner?.provider || "unknown";
  return {
    v: 2,
    blendId: invite.id,
    slug: invite.slug,
    short: true,
    createdAt: invite.createdAt,
    host: {
      userId: invite.owner?.id || invite.ownerUserId || "",
      name: invite.owner?.displayName || "A spuddy",
      service: hostService,
      avatarUrl: invite.owner?.avatarUrl || "",
      sourceLabel: SERVICES[hostService]?.sourceLabel || "Songs",
      count: invite.owner?.trackCount || invite.tracks?.length || 0,
    },
    tracks: includeTracks
      ? (invite.tracks || []).map((track) =>
        toTrack({
          ...track,
          service: hostService,
          id: track.providerTrackId || track.id,
          uri: track.uri,
          providerTrackDbId: track.id || "",
          artworkUrl: track.artworkUrl || "",
          url: track.url || "",
        }),
      )
      : [],
  };
}

function routeLink(route) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = route;
  return url.toString();
}

function isOwnInvite(invite = state.invite) {
  const inviteOwnerId = invite?.host?.userId || invite?.ownerUserId || "";
  const currentUserId = state.potatunesAuth?.user?.id || "";
  return Boolean(inviteOwnerId && currentUserId && inviteOwnerId === currentUserId);
}

async function returnHomeForOwnInvite() {
  if (!state.session || !isOwnInvite()) return false;

  state.invite = null;
  state.invitePayload = "";
  state.matches = [];
  state.shareLink = "";
  state.activeBlend = null;
  state.resultPage = 1;
  state.readyToMash = false;
  state.mashComplete = false;
  state.loading = defaultLoadingState();
  sessionStorage.removeItem(STORAGE.pendingInvite);
  sessionStorage.removeItem(STORAGE.pendingInvitePayload);
  els.statusLog.classList.add("hidden");
  await refreshBlendHistory();
  setRoute("/account");
  return true;
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
    providerTrackDbId: input.providerTrackDbId || input.provider_track_db_id || "",
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
  const storedToken = getStoredItem(STORAGE.appleUserToken);
  if (storedToken && !music.musicUserToken) {
    try {
      music.musicUserToken = storedToken;
    } catch {
      // MusicKit owns this value in some browsers.
    }
  }
  const existingToken = music.musicUserToken || storedToken;
  if (existingToken) {
    setStoredItem(STORAGE.appleUserToken, existingToken);
    return music;
  }

  const userToken = await music.authorize();
  setStoredItem(STORAGE.appleUserToken, userToken || music.musicUserToken || "");
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
    throw new Error("Potatunes setup is not finished yet. Check the Cloudflare token worker.");
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
  const total = state.matches.length || 1;

  for (const [index, match] of state.matches.entries()) {
    const existing = [match.yourTrack, match.hostTrack].find((track) => track?.service === "spotify" && track.uri);
    if (existing?.uri) {
      items.push(existing.uri);
      setLoadingProgress("generate", 30 + ((index + 1) / total) * 40, {
        copy: "Finding playlist tracks.",
        counter: `${index + 1}/${total}`,
        showArtwork: false,
      });
      continue;
    }

    const uri = await searchSpotifyTrack(accessToken, preferredTrack(match));
    if (uri) {
      items.push(uri);
    } else {
      missing.push(preferredTrack(match).title);
    }
    setLoadingProgress("generate", 30 + ((index + 1) / total) * 40, {
      copy: "Finding playlist tracks.",
      counter: `${index + 1}/${total}`,
      showArtwork: false,
    });
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
  const total = state.matches.length || 1;

  for (const [index, match] of state.matches.entries()) {
    const existing = [match.yourTrack, match.hostTrack].find((track) => track?.service === "apple" && track.id);
    if (existing?.id) {
      items.push({
        id: existing.catalogId || existing.id,
        type: existing.catalogId ? "songs" : existing.appleType || "library-songs",
      });
      setLoadingProgress("generate", 30 + ((index + 1) / total) * 40, {
        copy: "Finding playlist tracks.",
        counter: `${index + 1}/${total}`,
        showArtwork: false,
      });
      continue;
    }

    const result = await searchAppleTrack(preferredTrack(match));
    if (result) {
      items.push(result);
    } else {
      missing.push(preferredTrack(match).title);
    }
    setLoadingProgress("generate", 30 + ((index + 1) / total) * 40, {
      copy: "Finding playlist tracks.",
      counter: `${index + 1}/${total}`,
      showArtwork: false,
    });
  }

  return {
    items: uniqueValues(items, (track) => `${track.type}:${track.id}`),
    missing,
  };
}

async function searchAppleTrack(reference) {
  const musicUserToken = getStoredItem(STORAGE.appleUserToken);
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
    setBusy(true);
    startPlaylistLoading(targetService);
    if (targetService === "spotify") {
      if (!state.config.spotifyClientId) {
        throw new Error("Potatunes setup is not finished yet. Check Spotify and Cloudflare setup.");
      }
      if (!getStoredItem(STORAGE.spotifyToken)) {
        saveAppSnapshot();
        await beginSpotifyAuth("export-spotify");
        return;
      }
      await createSpotifyPlaylist();
    } else if (targetService === "apple") {
      if (!hasAppleTokenSource()) {
        throw new Error("Potatunes setup is not finished yet. Check the Cloudflare token worker.");
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

function startPlaylistLoading(targetService) {
  startLoadingFlow("generate", {
    title: "Generating",
    copy: `Planting in ${serviceName(targetService)}.`,
    counter: "mix",
    progress: 16,
    steps: [],
    showArtwork: false,
  });
  markLoadingStepDone("yourSongs", { render: false });
  markLoadingStepDone("spuddySongs", { render: false });
  markLoadingStepDone("mash", { render: false });
  state.loading.stage = "generate";
  renderLoadingPanel();
}

async function createSpotifyPlaylist() {
  if (!state.loading.active) startPlaylistLoading("spotify");
  setLoadingProgress("generate", 24, {
    copy: "Checking Spotify tracks.",
    counter: "...",
    showArtwork: false,
  });
  const accessToken = await getSpotifyAccessToken();
  const profile = await fetchSpotifyProfile(accessToken);
  const { items: uris, missing } = await resolveSpotifyPlaylistUris(accessToken);
  if (!uris.length) throw new Error("Spotify could not find any matching tracks.");

  setLoadingProgress("generate", 78, {
    copy: "Planting the playlist.",
    counter: String(uris.length),
    showArtwork: false,
  });
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

  const chunks = chunkArray(uris, 100);
  for (const [index, chunk] of chunks.entries()) {
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
    setLoadingProgress("generate", 82 + ((index + 1) / chunks.length) * 14, {
      copy: "Planting the playlist.",
      counter: String(uris.length),
      showArtwork: false,
    });
  }

  const skipped = missing.length ? ` ${missing.length} tune${missing.length === 1 ? "" : "s"} could not be found.` : "";
  markLoadingStepDone("generate", {
    copy: "Spotify playlist planted.",
    counter: String(uris.length),
    showArtwork: false,
  });
  setStatus(`Planted ${uris.length} tune${uris.length === 1 ? "" : "s"} in Spotify.${skipped}`, "info");
}

async function createApplePlaylist() {
  if (!state.loading.active) startPlaylistLoading("apple");
  setLoadingProgress("generate", 24, {
    copy: "Checking Apple Music tracks.",
    counter: "...",
    showArtwork: false,
  });
  const music = await ensureAppleAuthorized();
  const musicUserToken = music?.musicUserToken || getStoredItem(STORAGE.appleUserToken);
  if (!musicUserToken) throw new Error("Apple Music is not connected.");
  const developerToken = await getAppleDeveloperToken();

  const { items: tracks, missing } = await resolveApplePlaylistTracks();
  if (!tracks.length) throw new Error("Apple Music could not find any matching tracks.");

  setLoadingProgress("generate", 78, {
    copy: "Planting the playlist.",
    counter: String(tracks.length),
    showArtwork: false,
  });
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

  const chunks = chunkArray(tracks, 100);
  for (const [index, chunk] of chunks.entries()) {
    const response = await fetch(`https://api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ data: chunk }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.errors?.[0]?.detail || "Apple Music could not add tracks.");
    }
    setLoadingProgress("generate", 82 + ((index + 1) / chunks.length) * 14, {
      copy: "Planting the playlist.",
      counter: String(tracks.length),
      showArtwork: false,
    });
  }

  const skipped = missing.length ? ` ${missing.length} tune${missing.length === 1 ? "" : "s"} could not be found.` : "";
  markLoadingStepDone("generate", {
    copy: "Apple Music playlist planted.",
    counter: String(tracks.length),
    showArtwork: false,
  });
  setStatus(`Planted ${tracks.length} tune${tracks.length === 1 ? "" : "s"} in Apple Music.${skipped}`, "info");
}

function playlistName() {
  return `Potatunes ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

async function copyInviteLink() {
  if (!state.shareLink) return;
  await copyText(state.shareLink, "Spud link copied.");
}

async function copyMyInviteLink() {
  try {
    await ensureMyInviteLink();
    await copyText(state.myShareLink, "Your invite link is copied.");
    render();
  } catch (error) {
    setStatus(error.message || "Could not copy your invite link.", "error");
  }
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(successMessage, "info");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    setStatus(successMessage, "info");
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

  let loading = false;
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
    state.invitePayload = "";
    state.readyToMash = false;
    state.mashComplete = false;
    sessionStorage.setItem(STORAGE.pendingInvite, JSON.stringify(state.invite));
    if (state.session?.tracks?.length) {
      loading = true;
      setBusy(true);
      startLoadingFlow("spuddySongs", {
        title: "Finding your spuddy's songs",
        copy: `${state.invite.tracks.length} spuddy tunes in the sack.`,
        counter: String(state.invite.tracks.length),
        progress: 65,
        steps: ["yourSongs", "spuddySongs", "mash", "generate"],
        showArtwork: false,
      });
      markLoadingStepDone("yourSongs", {
        counter: String(state.session.tracks.length),
        render: false,
      });
      markLoadingStepDone("spuddySongs", {
        counter: String(state.invite.tracks.length),
        render: false,
      });
      renderLoadingPanel();
      await waitForPaint();
      setLoadingProgress("mash", 38, {
        title: "Mashing overlaps",
        copy: "Squishing the shared favorites.",
        counter: "...",
        showArtwork: false,
      });
      await waitForPaint();
      state.matches = matchTracks(state.invite.tracks, state.session.tracks);
      state.resultPage = 1;
      state.mashComplete = true;
      markLoadingStepDone("mash", {
        copy: `${state.matches.length} overlaps mashed.`,
        counter: String(state.matches.length),
        showArtwork: false,
      });
      markLoadingStepDone("generate", {
        title: "Generating",
        copy: "Mash ready.",
        counter: String(state.matches.length),
        showArtwork: false,
      });
      await ensureMyInviteLink();
      saveCurrentBlendHistory();
      setStatus(`Sack imported. Found ${state.matches.length} shared tune${state.matches.length === 1 ? "" : "s"}.`, "info");
    } else {
      setStatus("Sack imported. Pick your app to mash it.", "info");
    }
  } catch {
    setStatus("That file was not a valid potato sack.", "error");
  } finally {
    if (loading) setBusy(false);
    render();
  }
}

function exportCsv() {
  if (!state.matches.length) return;
  const rows = [
    ["Title", "Artists", "Album", "Matched title", "Matched artists"],
    ...state.matches.map((match) => [
      match.yourTrack.title,
      match.yourTrack.artists.join(", "),
      match.yourTrack.album,
      match.hostTrack.title,
      match.hostTrack.artists.join(", "),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadFile("potatunes-results.csv", csv, "text/csv");
}

function saveCurrentBlendHistory() {
  if (!state.invite || !state.session || !state.matches.length) return;

  const id = state.activeBlend?.id || state.invite.blendId || crypto.randomUUID?.() || randomString(24);
  const item = {
    id,
    matchedAt: new Date().toISOString(),
    friendName: state.invite.host?.name || "A friend",
    friendService: state.invite.host?.service || "unknown",
    friendAvatarUrl: state.invite.host?.avatarUrl || "",
    myName: state.session.profile?.name || "Me",
    myService: state.session.service,
    hostTrackCount: state.invite.tracks?.length || 0,
    myTrackCount: state.session.tracks?.length || 0,
    matchCount: state.matches.length,
    matches: state.matches.map((match) => ({
      score: match.score,
      reason: match.reason,
      hostTrack: compactHistoryTrack(match.hostTrack),
      yourTrack: compactHistoryTrack(match.yourTrack),
    })),
  };

  const next = [item, ...state.blendHistory.filter((blend) => blend.id !== id)].slice(0, 25);
  state.blendHistory = next;
  saveBlendHistory(next);
}

async function saveBackendBlendIfPossible() {
  if (!state.potatunesAuth?.session?.token || !apiBase() || !state.invite?.slug || !state.session?.tracks?.length) {
    return null;
  }

  try {
    const snapshot = await createLibrarySnapshotForSession();
    const body = await apiRequest("/api/blends", {
      method: "POST",
      auth: true,
      body: {
        inviteSlug: state.invite.slug,
        guestSnapshotId: snapshot.id,
        matches: state.matches.map(backendMatchPayload),
      },
    });
    return body.blend || null;
  } catch (error) {
    const code = error.data?.code;
    if ((code === "blend_already_exists" || code === "blend_refresh_available") && error.data?.existingBlend?.id) {
      const blend = await fetchBlendById(error.data.existingBlend.id).catch(() => null);
      setStatus(error.message, code === "blend_refresh_available" ? "info" : "error");
      return blend;
    }
    return null;
  }
}

function backendMatchPayload(match) {
  const preferred = preferredTrack(match);
  return {
    title: preferred.title,
    artists: preferred.artists,
    isrc: preferred.isrc || match.hostTrack.isrc || match.yourTrack.isrc || "",
    score: match.score,
    reason: match.reason,
    hostTrack: compactTrackForSnapshot(match.hostTrack),
    guestTrack: compactTrackForSnapshot(match.yourTrack),
  };
}

async function refreshBlendHistory() {
  const localHistory = loadBlendHistory();
  if (!state.potatunesAuth?.user?.id || !state.potatunesAuth?.session?.token || !apiBase()) {
    state.blendHistory = localHistory;
    return;
  }

  try {
    const body = await apiRequest(`/api/users/${encodeURIComponent(state.potatunesAuth.user.id)}/blends?limit=25`, {
      auth: true,
    });
    const remote = (body.blends || []).map(blendSummaryFromApi).filter((blend) => !isSampleBlend(blend));
    const remoteIds = new Set(remote.map((blend) => blend.id));
    state.blendHistory = [...remote, ...localHistory.filter((blend) => !remoteIds.has(blend.id))].slice(0, 25);
  } catch {
    state.blendHistory = localHistory;
  }
}

async function fetchBlendById(blendId) {
  const body = await apiRequest(`/api/blends/${encodeURIComponent(blendId)}`, {
    auth: true,
  });
  return body.blend || null;
}

function blendSummaryFromApi(blend) {
  const currentUserId = state.potatunesAuth?.user?.id || "";
  const friend = blend.friend || (blend.host?.id === currentUserId ? blend.guest : blend.host) || {};
  const me = blend.host?.id === friend.id ? blend.guest : blend.host;
  return {
    id: blend.id,
    source: "api",
    matchedAt: blend.createdAt,
    friendName: friend.displayName || "A spuddy",
    friendService: friend.provider || "unknown",
    friendAvatarUrl: friend.avatarUrl || "",
    myName: me?.displayName || state.session?.profile?.name || "Me",
    myService: me?.provider || state.session?.service || "unknown",
    hostTrackCount: 0,
    myTrackCount: 0,
    matchCount: blend.matchCount || 0,
    matches: [],
  };
}

function activateApiBlend(blend) {
  if (!blend) return;
  const summary = blendSummaryFromApi(blend);
  state.activeBlend = {
    ...summary,
    hostName: blend.host?.displayName || "A spuddy",
    hostService: blend.host?.provider || "unknown",
    guestName: blend.guest?.displayName || "A spuddy",
    guestService: blend.guest?.provider || "unknown",
    matches: (blend.tracks || []).map((track) => matchFromApiBlendTrack(track, blend)),
  };
  state.matches = state.activeBlend.matches;
  state.resultPage = 1;
  state.readyToMash = false;
  state.mashComplete = true;
}

function matchFromApiBlendTrack(track, blend) {
  const displayTrack = {
    title: track.title || "Untitled",
    artists: Array.isArray(track.artists) && track.artists.length ? track.artists : ["Unknown artist"],
    isrc: track.isrc || "",
  };
  return {
    score: Number(track.score || 0),
    reason: track.reason || "",
    hostTrack: toTrack({
      ...displayTrack,
      service: blend.host?.provider || "unknown",
      id: "",
    }),
    yourTrack: toTrack({
      ...displayTrack,
      service: blend.guest?.provider || "unknown",
      id: "",
    }),
  };
}

function compactHistoryTrack(track) {
  return {
    service: track.service,
    id: track.id,
    uri: track.uri,
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    artworkUrl: track.artworkUrl,
    url: track.url,
    appleType: track.appleType,
    catalogId: track.catalogId,
  };
}

function loadBlendHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE.blendHistory) || "[]");
    if (!Array.isArray(parsed)) {
      saveBlendHistory([]);
      return [];
    }
    const history = Array.isArray(parsed) ? parsed.filter((blend) => !isSampleBlend(blend)) : [];
    if (history.length !== parsed.length) saveBlendHistory(history);
    return history;
  } catch {
    return [];
  }
}

function saveBlendHistory(history) {
  try {
    localStorage.setItem(STORAGE.blendHistory, JSON.stringify(history.filter((blend) => !isSampleBlend(blend))));
  } catch {
    // Local blend history is optional.
  }
}

function isSampleBlend(blend) {
  return /sample .*spud/i.test(`${blend?.friendName || ""} ${blend?.myName || ""}`);
}

async function openBlendHistory(event) {
  const button = event.target.closest("[data-blend-id]");
  if (!button) return;
  await openBlendById(button.dataset.blendId, { navigate: true });
}

async function openBlendById(blendId, { navigate = true } = {}) {
  const item = state.blendHistory.find((blend) => blend.id === blendId);
  if (!item && !state.potatunesAuth?.session?.token) return;

  if ((!item || item.source === "api" || !item.matches?.length) && state.potatunesAuth?.session?.token && apiBase()) {
    try {
      const blend = await fetchBlendById(blendId);
      if (blend) {
        activateApiBlend(blend);
        els.statusLog.classList.add("hidden");
        if (navigate) setRoute(`/mash/${encodeURIComponent(blend.id)}`, { replace: false });
        render();
        return;
      }
    } catch {
      setStatus("That mash could not be opened.", "error");
      render();
      return;
    }
  }

  if (!item) return;

  state.activeBlend = item;
  state.resultPage = 1;
  state.matches = item.matches.map((match) => ({
    score: match.score,
    reason: match.reason,
    hostTrack: toTrack(match.hostTrack),
    yourTrack: toTrack(match.yourTrack),
  }));
  state.invite = {
    v: 1,
    blendId: item.id,
    createdAt: item.matchedAt,
    host: {
      name: item.friendName,
      service: item.friendService,
      avatarUrl: item.friendAvatarUrl || "",
      count: item.hostTrackCount,
    },
    tracks: item.matches.map((match) => toTrack(match.hostTrack)),
  };
  state.invitePayload = "";
  state.readyToMash = false;
  state.mashComplete = true;
  els.statusLog.classList.add("hidden");
  if (navigate) setRoute(`/mash/${encodeURIComponent(item.id)}`, { replace: false });
  render();
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

function clearSession({ clearAuth = false } = {}) {
  sessionStorage.removeItem(STORAGE.spotifyOAuth);
  sessionStorage.removeItem(STORAGE.pendingInvite);
  sessionStorage.removeItem(STORAGE.pendingInvitePayload);
  sessionStorage.removeItem(STORAGE.appSnapshot);
  if (clearAuth) {
    removeStoredItem(STORAGE.spotifyToken);
    removeStoredItem(STORAGE.appleUserToken);
    removeStoredItem(STORAGE.appleDisplayName);
    removeStoredItem(STORAGE.potatunesAuth);
  }
  state.invite = null;
  state.session = null;
  if (clearAuth) state.potatunesAuth = null;
  state.matches = [];
  state.shareLink = "";
  state.myInvite = null;
  state.myShareLink = "";
  state.activeBlend = null;
  state.resultPage = 1;
  state.invitePayload = "";
  state.readyToMash = false;
  state.mashComplete = false;
  state.welcomeBack = false;
  state.loading = defaultLoadingState();
  setRoute("/");
}

function goHome() {
  if (state.session) {
    state.invite = null;
    state.matches = [];
    state.activeBlend = null;
    state.invitePayload = "";
    state.readyToMash = false;
    state.mashComplete = false;
    state.resultPage = 1;
    sessionStorage.removeItem(STORAGE.pendingInvite);
    sessionStorage.removeItem(STORAGE.pendingInvitePayload);
    els.statusLog.classList.add("hidden");
    setRoute("/account");
    render();
    return;
  }
  clearSession();
  els.statusLog.classList.add("hidden");
  render();
}

function logout() {
  clearSession({ clearAuth: true });
  setStatus("Logged out.", "info");
  render();
}

function resetSession() {
  clearSession({ clearAuth: true });
  setStatus("Session reset.", "info");
  render();
}

function saveAppSnapshot() {
  sessionStorage.setItem(
    STORAGE.appSnapshot,
    JSON.stringify({
      invite: state.invite,
      session: state.session,
      shareLink: state.shareLink,
      myInvite: state.myInvite,
      myShareLink: state.myShareLink,
      invitePayload: state.invitePayload,
      readyToMash: state.readyToMash,
      mashComplete: state.mashComplete,
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
  state.myInvite = snapshot.myInvite || null;
  state.myShareLink = snapshot.myShareLink || "";
  state.invitePayload = snapshot.invitePayload || "";
  state.matches = state.invite && state.session ? matchTracks(state.invite.tracks, state.session.tracks) : [];
  state.readyToMash = Boolean(snapshot.readyToMash && state.invite && state.session && !state.matches.length);
  state.mashComplete = Boolean(snapshot.mashComplete || state.matches.length);
}

function render() {
  renderConfigBadge();
  renderTopAccount();
  renderModeBanner();
  renderPanels();
  renderInviteIntro();
  renderVerifiedPanel();
  renderLoadingPanel();
  renderSteps();
  renderBackButton();
  renderButtons();
  normalizeRoute();
  if (window.lucide) window.lucide.createIcons();
}

function renderConfigBadge() {
  const hasSpotify = Boolean(state.config.spotifyClientId);
  const hasApple = hasAppleTokenSource();
  els.configBadge.className = `status-pill ${hasSpotify && hasApple ? "ready" : "warning"}`;
  els.configBadge.textContent = hasSpotify && hasApple ? "Configured" : "Needs config";
}

function renderTopAccount() {
  if (!state.session) {
    els.topAccount.classList.add("hidden");
    els.topAccount.innerHTML = "";
    return;
  }

  const service = state.session.service;
  const name = state.session.profile?.name || `${serviceName(service)} listener`;
  els.topAccount.classList.remove("hidden");
  els.topAccount.innerHTML = `
    <span class="service-icon ${service === "spotify" ? "spotify-logo" : "apple-logo"}" aria-hidden="true"><span></span></span>
    <span>
      <strong>${escapeHtml(name)}</strong>
      <small>${escapeHtml(serviceName(service))}</small>
    </span>
  `;
}

function renderModeBanner() {
  els.modeBanner.classList.add("hidden");
}

function renderPanels() {
  const hasSession = Boolean(state.session);
  const hasInvite = Boolean(state.invite);
  const isJoinFlow = Boolean(hasSession && hasInvite && !state.shareLink);
  const isVerified = Boolean(isJoinFlow && state.readyToMash && !state.mashComplete);
  const hasJoinResults = Boolean(isJoinFlow && state.mashComplete);
  const showResults = hasJoinResults || state.matches.length > 0;
  const loading = state.busy && state.loading.active;

  els.connectPanel.classList.toggle("hidden", loading || hasSession || showResults);
  els.accountPanel.classList.toggle("hidden", loading || !hasSession || isJoinFlow || showResults);
  els.libraryPanel.classList.toggle("hidden", !loading);
  els.verifiedPanel.classList.toggle("hidden", loading || !isVerified);
  els.invitePanel.classList.add("hidden");
  els.resultsPanel.classList.toggle("hidden", loading || !showResults);

  if (hasSession && !isJoinFlow && !showResults) renderAccountPanel();
  if (showResults) renderResults();
}

function renderInviteIntro() {
  if (!state.invite || state.session) {
    els.inviteIntro.classList.add("hidden");
    return;
  }

  const hostName = state.invite.host?.name || "A spuddy";
  const platform = serviceName(state.invite.host?.service);
  els.inviteIntro.classList.remove("hidden");
  els.inviteIntroTitle.textContent = `${hostName} (${platform}) wants to be spuddies!`;
  els.inviteIntroCopy.textContent = "Log in to see your shared liked songs";
}

function renderVerifiedPanel() {
  if (!state.readyToMash || !state.invite || !state.session) return;

  const name = state.session.profile?.name || "this account";
  const platform = serviceName(state.session.service);
  els.verifiedTitle.textContent = "successfully verified!";
  els.verifiedCopy.textContent = `Logged in as ${name} (${platform}).`;
}

function renderBackButton() {
  const isHome =
    !state.invite &&
    !state.session &&
    !state.shareLink &&
    !state.matches.length &&
    !state.activeBlend;
  els.homeButton.classList.toggle("hidden", isHome);
}

function renderAccountPanel() {
  const name = state.session?.profile?.name || "Potatunes listener";
  const service = serviceName(state.session?.service);
  els.accountSummary.textContent = state.welcomeBack
    ? `Welcome back! ${name} (${service})`
    : `${name} (${service})`;

  if (!state.blendHistory.length) {
    els.blendHistoryList.innerHTML = `<p class="empty-copy">No mashes yet.</p>`;
    return;
  }

  els.blendHistoryList.innerHTML = state.blendHistory
    .map((blend) => {
      const when = new Date(blend.matchedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      return `
        <button class="blend-history-item" type="button" data-blend-id="${escapeAttribute(blend.id)}">
          ${friendAvatarHtml(blend)}
          <span class="blend-history-copy">
            <strong>${escapeHtml(blend.friendName)} (${escapeHtml(serviceName(blend.friendService))})</strong>
            <small>${escapeHtml(when)}</small>
          </span>
          <em>${escapeHtml(blend.matchCount)}</em>
        </button>
      `;
    })
    .join("");
}

function friendAvatarHtml(blend) {
  if (blend.friendAvatarUrl) {
    return `
      <span class="friend-avatar">
        <img src="${escapeAttribute(blend.friendAvatarUrl)}" alt="" loading="lazy" />
      </span>
    `;
  }

  const service = blend.friendService === "spotify" ? "spotify-logo" : "apple-logo";
  return `
    <span class="friend-avatar service-avatar">
      <span class="service-icon ${service}" aria-hidden="true"><span></span></span>
    </span>
  `;
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
  const activeBlend = state.activeBlend;
  const matchCount = state.matches.length;
  const totalPages = Math.max(1, Math.ceil(matchCount / RESULTS_PAGE_SIZE));
  state.resultPage = clamp(state.resultPage || 1, 1, totalPages);
  const pageStart = (state.resultPage - 1) * RESULTS_PAGE_SIZE;
  const pageMatches = state.matches.slice(pageStart, pageStart + RESULTS_PAGE_SIZE);

  els.matchCount.textContent = matchCount;
  els.resultTitle.textContent = activeBlend
    ? mashTitle(activeBlend)
    : matchCount
      ? `${matchCount} tune${matchCount === 1 ? "" : "s"} in the same sack`
      : "No shared spuds yet";
  els.resultCopy.textContent = matchCount
    ? activeBlend
      ? "All the songs you both mashed."
      : "Plant the playlist where you want it."
    : "No musical potatoes overlapped this time.";

  els.resultStats.classList.toggle("hidden", Boolean(activeBlend));
  els.resultStats.innerHTML = activeBlend
    ? ""
    : [
      statHtml(state.invite?.tracks?.length || 0, `${serviceName(state.invite?.host?.service)} potatoes`),
      statHtml(state.session?.tracks?.length || 0, `${serviceName(state.session?.service)} potatoes`),
      statHtml(matchCount, "Shared spuds"),
    ].join("");

  els.matchList.innerHTML = pageMatches
    .map((match) => matchRowHtml(match))
    .join("") || `<div class="notice">No matches found. Try exporting both libraries and reviewing titles manually.</div>`;

  els.resultPager.classList.toggle("hidden", totalPages <= 1);
  els.resultPageLabel.textContent = `Page ${state.resultPage} of ${totalPages}`;
  els.resultPrevButton.disabled = state.busy || state.resultPage <= 1;
  els.resultNextButton.disabled = state.busy || state.resultPage >= totalPages;
}

function mashTitle(blend) {
  const left = blend.myName || state.session?.profile?.name || "You";
  const right = blend.friendName || "Spuddy";
  return `${left} & ${possessive(right)} mash`;
}

function possessive(name) {
  return `${name}${/s$/i.test(name) ? "'" : "'s"}`;
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
    </article>
  `;
}

function changeResultPage(delta) {
  const totalPages = Math.max(1, Math.ceil(state.matches.length / RESULTS_PAGE_SIZE));
  state.resultPage = clamp((state.resultPage || 1) + delta, 1, totalPages);
  renderResults();
  renderButtons();
  if (window.lucide) window.lucide.createIcons();
}

function renderSteps() {
  const hasSession = Boolean(state.session);
  const hasInvite = Boolean(state.invite);
  const hasJoinResults = Boolean(hasInvite && hasSession && !state.shareLink && state.mashComplete);
  const hasBlend = state.matches.length > 0 || state.shareLink || hasJoinResults;
  setStep(els.stepConnect, hasSession ? "done" : "active");
  setStep(els.stepCollect, hasSession ? (hasBlend || state.readyToMash ? "done" : "active") : "");
  setStep(els.stepBlend, hasBlend || state.readyToMash ? "active" : "");
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
    els.homeButton,
    els.importButton,
    els.mashButton,
    els.copyMyInviteButton,
    els.logoutButton,
    els.copyInviteButton,
    els.downloadPackButton,
    els.exportCsvButton,
    els.spotifyExportButton,
    els.appleExportButton,
    els.resultPrevButton,
    els.resultNextButton,
  ].forEach((button) => {
    button.disabled = disabled;
  });

  els.copyInviteButton.disabled = disabled || !state.shareLink;
  els.mashButton.disabled = disabled || !state.readyToMash || !state.invite || !state.session?.tracks?.length;
  els.copyMyInviteButton.disabled = disabled || !state.session?.tracks?.length;
  els.downloadPackButton.disabled = disabled || !state.invite;
  els.exportCsvButton.disabled = disabled || !state.matches.length;
  els.spotifyExportButton.disabled = disabled || !state.matches.length;
  els.appleExportButton.disabled = disabled || !state.matches.length;
  const totalPages = Math.max(1, Math.ceil(state.matches.length / RESULTS_PAGE_SIZE));
  els.resultPrevButton.disabled = disabled || state.resultPage <= 1;
  els.resultNextButton.disabled = disabled || state.resultPage >= totalPages;
}

function renderCollecting(serviceNameText, count, total, options = {}) {
  state.loading = {
    ...defaultLoadingState(),
    active: true,
    title: options.title || "Finding your songs",
    copy: options.copy || `${serviceNameText} is digging through your saved tunes.`,
    counter: String(count),
    steps: [],
    showArtwork: false,
  };
  updateLibraryProgress(count, total);
  render();
}

function updateLibraryProgress(count, total) {
  const pct = total ? clamp((count / total) * 100, 8, 100) : 12;
  setLoadingProgress("yourSongs", pct, {
    copy: total > count ? `${count} of about ${total} tunes dug up.` : `${count} tunes dug up.`,
    counter: String(count),
    render: false,
  });
  renderLoadingPanel();
}

function defaultLoadingState() {
  return {
    active: false,
    title: "Digging up songs",
    copy: "A short potato pause.",
    counter: "0",
    stage: "yourSongs",
    progress: {
      yourSongs: 0,
      spuddySongs: 0,
      mash: 0,
      generate: 0,
    },
    steps: [],
    showArtwork: true,
  };
}

function startLoadingFlow(stage, options = {}) {
  state.loading = {
    ...defaultLoadingState(),
    active: true,
    stage,
    title: options.title || "Digging up songs",
    copy: options.copy || "A short potato pause.",
    counter: options.counter || "0",
    steps: options.steps || [],
    showArtwork: options.showArtwork ?? true,
  };
  setLoadingProgress(stage, options.progress ?? 12, { render: false });
  render();
}

function setLoadingProgress(stage, pct, options = {}) {
  if (!state.loading.active) {
    state.loading = { ...defaultLoadingState(), active: true };
  }
  state.loading.stage = stage;
  state.loading.progress = {
    ...defaultLoadingState().progress,
    ...state.loading.progress,
    [stage]: clamp(pct, 0, 100),
  };
  if (options.title) state.loading.title = options.title;
  if (options.copy !== undefined) state.loading.copy = options.copy;
  if (options.counter !== undefined) state.loading.counter = options.counter;
  if (options.steps !== undefined) state.loading.steps = options.steps;
  if (options.showArtwork !== undefined) state.loading.showArtwork = options.showArtwork;
  if (options.render !== false) renderLoadingPanel();
}

function markLoadingStepDone(stage, options = {}) {
  setLoadingProgress(stage, 100, options);
}

function renderLoadingPanel() {
  if (!els.libraryTitle || !els.blendFlow) return;

  const loading = state.loading;
  els.libraryTitle.textContent = loading.title;
  els.libraryCopy.textContent = loading.copy;
  els.libraryCounter.textContent = loading.counter;

  const visibleSteps = loading.steps?.length
    ? LOADING_STEPS.filter((step) => loading.steps.includes(step.id))
    : [];
  const overallPct = visibleSteps.length
    ? visibleSteps.reduce((total, step) => total + (loading.progress[step.id] || 0), 0) / visibleSteps.length
    : loading.progress[loading.stage] || 0;
  els.progressFill.style.width = `${clamp(overallPct, loading.active ? 8 : 0, 100)}%`;

  els.blendFlow.innerHTML = visibleSteps.map((step) => loadingStepHtml(step, loading)).join("");

  if (loading.showArtwork) {
    renderArtworkPreview(state.session?.tracks || []);
  } else {
    els.sampleArtwork.innerHTML = "";
  }
}

function loadingStepHtml(step, loading) {
  const pct = loading.progress[step.id] || 0;
  const active = loading.stage === step.id && pct < 100;
  const done = pct >= 100;
  const activeStatus = {
    yourSongs: "digging",
    spuddySongs: "digging",
    mash: "mashing",
    generate: "baking",
  }[step.id];
  const status = done ? "done" : active ? activeStatus : "next";
  return `
    <div class="blend-step ${done ? "done" : active ? "active" : ""}">
      <div class="blend-step-copy">
        <strong>${escapeHtml(step.label)}</strong>
        <span>${status}</span>
      </div>
      <div class="blend-step-track" aria-hidden="true">
        <span style="width: ${pct}%"></span>
      </div>
    </div>
  `;
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
  if (!value) state.loading = defaultLoadingState();
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

function getStoredItem(key) {
  return sessionStorage.getItem(key) || localStorage.getItem(key);
}

function setStoredItem(key, value) {
  sessionStorage.setItem(key, value);
  localStorage.setItem(key, value);
}

function removeStoredItem(key) {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

function loadPotatunesAuth() {
  const auth = safeJsonParse(getStoredItem(STORAGE.potatunesAuth));
  if (!auth?.session?.token || !auth?.user?.id) return null;
  if (auth.session.expiresAt && Date.parse(auth.session.expiresAt) <= Date.now()) {
    removeStoredItem(STORAGE.potatunesAuth);
    return null;
  }
  return auth;
}

function hasPriorServiceSession(service) {
  const auth = loadPotatunesAuth();
  if (auth?.user?.provider === service) return true;
  if (service === "spotify") return Boolean(getStoredItem(STORAGE.spotifyToken));
  if (service === "apple") return Boolean(getStoredItem(STORAGE.appleUserToken));
  return false;
}

function savePotatunesAuth(auth) {
  if (!auth?.session?.token || !auth?.user?.id) return null;
  state.potatunesAuth = auth;
  setStoredItem(STORAGE.potatunesAuth, JSON.stringify(auth));
  return auth;
}

function apiBase() {
  return String(state.config.apiBase || "").replace(/\/+$/, "");
}

async function apiRequest(path, { method = "GET", body, auth = false } = {}) {
  const base = apiBase();
  if (!base) throw new Error("Potatunes backend is not configured.");

  const headers = {
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = state.potatunesAuth?.session?.token;
    if (!token) throw new Error("Potatunes session is not connected.");
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Potatunes backend request failed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
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

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
