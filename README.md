# Potatunes

A GitHub Pages web app plus Cloudflare Worker backend that lets Spotify listeners and Apple Music listeners find the songs they both saved or kept in their library.

Secrets stay server-side:

- Spotify uses Authorization Code with PKCE, so no client secret is needed in the browser.
- Apple Music developer tokens are signed by the Worker.
- Cloudflare D1 stores durable users, invite slugs, library snapshots, blends, and playlist export records.
- Provider tokens and Potatunes session tokens are never placed in invite links.

## What It Does

1. First listener connects Spotify or Apple Music.
2. The app reads their saved/library songs, deduplicates them, and stores a library snapshot.
3. Friend opens the invite and connects their account.
4. Potatunes finds the shared songs.
5. The result can be saved to Spotify, Apple Music, or CSV, with export records stored in D1.

## Identity Model

Potatunes now has a D1-backed identity model:

- `users` stores the provider, provider user ID, and display name.
- `library_snapshots` stores each saved/library song pull.
- `blend_invites` stores shareable invite slugs.
- `blends` and `blend_tracks` store each friend overlap.
- `playlist_exports` stores Spotify, Apple Music, and CSV export records.

The same person can create multiple invite links and multiple blends with different friends. Each blend is attached to the signed-in Potatunes user session and the invite used to create it.

The frontend still has compressed-link fallback code from the original static prototype. The next integration step is switching the live UI to the D1 invite/session routes.

## Matching Design

The GitHub Pages version does not call an LLM because API keys cannot be safely embedded in a public static app. Instead, it uses a deterministic matching layer:

- exact ISRC match when both platforms expose it
- normalized title + primary artist match
- fuzzy scoring across title, artist, and duration
- cleanup for radio edits, remasters, featured artists, punctuation, duplicate releases, and common version labels
- penalties for likely-different versions such as live, acoustic, instrumental, karaoke, and remix

If you later add an LLM, the best place for it is as a final reviewer for borderline matches, not as the primary matcher.

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

The Worker signs Apple Music developer tokens, verifies provider sign-ins, mints Potatunes sessions, and persists app data in D1.

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
wrangler secret put POTATUNES_SESSION_SECRET
```

For `APPLE_MEDIA_SERVICES_PRIVATE_KEY`, paste the full `.p8` contents or the same value with escaped `\n` newlines.

Set allowed origins in `worker/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "http://localhost:4173,https://YOUR_USER.github.io/YOUR_REPO"
```

Run locally:

```bash
npm run db:migrate:local
npm run worker:dev
```

Deploy:

```bash
npm run db:migrate:remote
npm run worker:deploy
```

Then set `APPLE_TOKEN_ENDPOINT` in your frontend `.env` or GitHub repository variable to:

```text
https://YOUR_WORKER_SUBDOMAIN.workers.dev/apple-music-token
```

### D1 Database

Create the database once:

```bash
cd worker
npx wrangler d1 create potatunes
```

Copy the returned `database_id` into `worker/wrangler.toml` under the `DB` binding, then apply migrations:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

The Worker API uses Potatunes bearer sessions for DB writes and private reads:

- `POST /api/auth/spotify`: verifies a Spotify access token, upserts a user, and returns a Potatunes session.
- `POST /api/auth/apple`: verifies a MusicKit user token, upserts a user, and returns a Potatunes session.
- `GET /api/me`: returns the signed-in Potatunes user for `Authorization: Bearer <session>`.
- `POST /api/library-snapshots`: stores a user's provider track list.
- `POST /api/invites`: creates a share slug for a snapshot.
- `GET /api/invites/:slug`: reads public invite metadata. Add `?tracks=true` with a session to fetch tracks.
- `POST /api/blends`: stores a completed overlap. If the same two users already have a blend, the API returns a `409` warning until the previous blend is at least 1 week old. Send `refresh: true` to create a refreshed blend after that cooldown.
- `GET /api/users/:id/blends`: lists a user's blends.
- `POST /api/playlist-exports`: stores Spotify, Apple Music, or CSV export metadata.

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

## Hosting Constraints

GitHub Pages cannot store room state or secrets. Potatunes uses Cloudflare for those pieces:

- Apple private keys and session secret are Worker secrets.
- D1 stores room state, library snapshots, blends, and export records.
- CORS limits browser access to approved origins, but authentication comes from Potatunes bearer sessions, not CORS.
- The frontend should call private DB routes with `Authorization: Bearer <session>`.
