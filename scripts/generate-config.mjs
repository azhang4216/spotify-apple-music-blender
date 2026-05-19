import { readFileSync, writeFileSync, existsSync } from "node:fs";

const APP_NAME = "Potatunes";
const APP_BUILD = "1.0.0";

loadDotEnv();

const config = {
  appName: env("APP_NAME") || APP_NAME,
  appBuild: env("APP_BUILD") || APP_BUILD,
  spotifyClientId: env("SPOTIFY_CLIENT_ID"),
  spotifyRedirectUri: env("SPOTIFY_REDIRECT_URI"),
  appleDeveloperToken: env("APPLE_DEVELOPER_TOKEN"),
  appleTokenEndpoint: env("APPLE_TOKEN_ENDPOINT"),
  apiBase: env("POTATUNES_API_BASE"),
  appleStorefrontId: env("APPLE_STOREFRONT_ID") || "us",
};

const outFile = env("CONFIG_OUT") || "config.js";

writeFileSync(
  outFile,
  `window.BLEND_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);

console.log(
  JSON.stringify(
    {
      wrote: outFile,
      hasSpotifyClientId: Boolean(config.spotifyClientId),
      hasSpotifyRedirectUri: Boolean(config.spotifyRedirectUri),
      hasAppleDeveloperToken: Boolean(config.appleDeveloperToken),
      hasAppleTokenEndpoint: Boolean(config.appleTokenEndpoint),
      hasApiBase: Boolean(config.apiBase),
      appleStorefrontId: config.appleStorefrontId,
    },
    null,
    2,
  ),
);

function loadDotEnv() {
  if (!existsSync(".env")) return;

  const body = readFileSync(".env", "utf8");
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquote(rawValue);
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function env(name) {
  return process.env[name]?.trim() || "";
}
