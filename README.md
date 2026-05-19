# Potatunes

A static GitHub Pages web app that lets one Spotify listener and one Apple Music listener find the songs they both saved or kept in their library.

The app is intentionally backend-free:

- Spotify uses Authorization Code with PKCE, so no client secret is needed in the browser.
- Apple Music uses MusicKit JS plus a developer token.
- OAuth tokens stay in `sessionStorage` and are never added to share links.
- Invite links contain normalized song metadata for the first listener, not service credentials.
- Large libraries can use a downloaded JSON blend pack when the URL would be too long.

## What It Does

1. First listener connects Spotify or Apple Music.
2. The app reads their saved/library songs, deduplicates them, and builds a compressed invite link.
3. Friend opens the invite and connects their account.
4. Matching happens locally in the friend's browser.
5. The friend can save the result to Spotify, Apple Music, or CSV.

## Identity Model

Potatunes does not create user accounts. Each invite link is its own blend session with a generated `blendId`.

That means the same person can make multiple links for different friends. Each link carries that host's normalized song list and is matched independently in the friend's browser. Without a database, the app does not maintain a global history of "who is who" across links.

If you later want account history, revocable links, or short room codes, add server-side room storage keyed by `blendId`.

## Matching Design

The GitHub Pages version does not call an LLM because API keys cannot be safely embedded in a public static app. Instead, it uses a deterministic matching layer:

- exact ISRC match when both platforms expose it
- normalized title + primary artist match
- fuzzy scoring across title, artist, and duration
- cleanup for radio edits, remasters, featured artists, punctuation, duplicate releases, and common version labels
- penalties for likely-different versions such as live, acoustic, instrumental, karaoke, and remix

If you later add a small backend, the best place for an LLM is as a final reviewer for borderline matches, not as the primary matcher.

## Playlist Export

The results screen has explicit buttons for `Save to Spotify`, `Save to Apple Music`, and `Export CSV`.

Saving to a target service requires authorization for that service in the current browser session. Cross-service saves use catalog search to resolve the matched song names and artists to target-platform IDs before creating the playlist.

## Setup

Potatunes reads credentials from environment variables and generates `config.js`.

Create a local `.env` from the sample:

```bash
cp .env.example .env
```

Fill in:

```text
SPOTIFY_CLIENT_ID=
SPOTIFY_REDIRECT_URI=http://localhost:4173/
APPLE_TOKEN_ENDPOINT=http://localhost:8787/apple-music-token
APPLE_STOREFRONT_ID=us
```

Then generate the browser config:

```bash
npm run build:config
```

`config.js` is generated and ignored by git. It should contain public browser config only.

Everything in `config.js` is public once deployed to GitHub Pages. Apple private-key material belongs only in the Cloudflare Worker secrets.

## Spotify App

Create a Spotify app and add redirect URIs for every place you run the app:

- `http://localhost:4173/`
- `https://YOUR_USER.github.io/YOUR_REPO/`

The app requests these scopes:

- `user-library-read`
- `user-read-private`
- `playlist-modify-private`
- `playlist-modify-public`

Relevant Spotify docs:

- [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Get User's Saved Tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks)
- [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist)
- [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-tracks-to-playlist)

## Apple Music App

Create a MusicKit Media ID and Media Services private key. The frontend fetches short-lived Apple developer tokens from the Cloudflare Worker in `worker/`.

The app uses:

- MusicKit JS authorization in the browser
- `music.api.library.songs()` for library songs
- Apple Music API ratings as a best-effort liked-song filter
- Apple Music API library playlist endpoints for saving matches

## Cloudflare Worker

The Worker signs Apple Music developer tokens without exposing the `.p8` private key to GitHub Pages.

Install Wrangler if needed:

```bash
npm install -g wrangler
```

Set Worker secrets:

```bash
cd worker
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_MEDIA_SERVICES_PRIVATE_KEY
```

For `APPLE_MEDIA_SERVICES_PRIVATE_KEY`, paste the full `.p8` contents or the same value with escaped `\n` newlines.

Set allowed origins in `worker/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "http://localhost:4173,https://YOUR_USER.github.io/YOUR_REPO"
```

Run locally:

```bash
wrangler dev
```

Deploy:

```bash
wrangler deploy
```

Then set `APPLE_TOKEN_ENDPOINT` in your frontend `.env` or GitHub repository variable to:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/apple-music-token
```

Relevant Apple docs:

- [MusicKit on the Web](https://js-cdn.music.apple.com/musickit/v3/docs/index.html)
- [Get All Library Songs](https://developer.apple.com/documentation/applemusicapi/get-all-library-songs)
- [Create a New Library Playlist](https://developer.apple.com/documentation/applemusicapi/create-a-new-library-playlist)
- [Add Tracks to a Library Playlist](https://developer.apple.com/documentation/applemusicapi/add-tracks-to-a-library-playlist)

## Local Development

Generate config, then start the static server:

```bash
npm run build:config
python3 -m http.server 4173
```

Open `http://localhost:4173/`.

## GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

In GitHub, set these repository secrets:

- `SPOTIFY_CLIENT_ID`

Set these repository variables:

- `SPOTIFY_REDIRECT_URI`: `https://YOUR_USER.github.io/YOUR_REPO/`
- `APPLE_TOKEN_ENDPOINT`: `https://YOUR_WORKER_SUBDOMAIN.workers.dev/apple-music-token`
- `APPLE_STOREFRONT_ID`: `us`

Then enable Pages with **Build and deployment > Source > GitHub Actions**.

Add the same `SPOTIFY_REDIRECT_URI` value to the Spotify app redirect URI list. Spotify requires an exact match.

## Static Hosting Constraints

GitHub Pages cannot store room state or secrets. This app works around that by putting normalized first-listener metadata in the invite link. That keeps deployment simple, but it has tradeoffs:

- Very large libraries can create links that are too long for some messengers. Use the blend pack fallback.
- Apple private keys are kept in the Cloudflare Worker, not GitHub Pages.
- A fully private room-code workflow needs a backend or serverless storage layer.
