# FCTV33 Stream Resolver

Self-hosted **Node.js** **HLS stream resolver** and **m3u8 proxy** for live FCTV33 sports. Open a local web console, browse live matches by sport, resolve a game to a tokenized CDN playlist through a small **REST API**, and play instantly in the browser — or copy Direct, Proxied, **VLC**, and **mpv** links from the same response.

The server talks to the upstream data API with signed protobuf requests, decodes ROT47 stream payloads, builds an AES-256-CBC session token URL, then relays HLS manifests and MPEG-TS segments with the player **Referer** headers the CDN expects. There are no npm runtime dependencies: TypeScript compiles to plain Node, and playback uses remote [hls.js](https://github.com/video-dev/hls.js).

## Table of Contents

- [Quick Start](#quick-start)
- [Why This Exists](#why-this-exists)
- [Features](#features)
- [How Resolution Works](#how-resolution-works)
- [Architecture](#architecture)
- [Web UI](#web-ui)
- [REST API](#rest-api)
  - [Overview](#overview)
  - [List Live Matches](#list-live-matches)
  - [Resolve a Match](#resolve-a-match)
  - [Proxy HLS](#proxy-hls)
- [Playback](#playback)
  - [Browser Player](#browser-player)
  - [Proxied Playlist](#proxied-playlist)
  - [Direct CDN with Referer](#direct-cdn-with-referer)
  - [VLC and mpv](#vlc-and-mpv)
- [Sport Types](#sport-types)
- [Stack and Scripts](#stack-and-scripts)
- [Configuration](#configuration)
- [Source Layout](#source-layout)
- [Common Issues](#common-issues)
- [Disclaimer](#disclaimer)

## Quick Start

Requires **Node.js 20+** (native `fetch` and ES modules).

```bash
git clone https://github.com/sharoon7171/fctv33-stream-resolver.git
cd fctv33-stream-resolver
npm start
```

`npm start` compiles TypeScript, frees the listen port if an old process is still bound, and runs `dist/server/main.js`. The terminal prints the base URL:

```text
http://localhost:3000
```

Open that address in a browser. Select a sport tab, click a live match, and the player resolves the stream and autoplays. Timing chips show resolve latency and time to first frame.

From the shell:

```bash
# Football live list
curl -s "http://localhost:3000/api/live?sportType=1" | jq .

# Resolve one match (replace matchId with a value from the list)
curl -s "http://localhost:3000/api/resolve?matchId=4331876&sportType=1" | jq .
```

Override the port when needed:

```bash
PORT=8080 npm start
```

## Why This Exists

Live FCTV33 playback is not a single public `.m3u8` link on the page. The site bootstraps a data API host, signs protobuf calls, returns an obfuscated stream URL, and expects the iframe player origin as **Referer** / **Origin** on CDN playlist and segment requests. Browsers cannot set those headers on cross-origin media fetches, so a bare CDN URL often fails with **403** inside `<video>` or hls.js.

This project turns that chain into three local endpoints:

1. **Live list** — matches that currently have streams, filtered by sport.
2. **Resolve** — match id → tokenized `streamUrl`, player `referer`, and a localhost `playableUrl`.
3. **HLS proxy** — fetches upstream with the correct headers and rewrites every playlist URI so segments keep flowing through the same proxy.

The result is a self-hosted stream resolver you can drive from the UI or from scripts, without pasting match page URLs or manually injecting headers.

## Features

- Live match rail with sport filters (Football, Basketball, Tennis, Cricket, and more)
- One-click resolve into a playable HLS session with on-screen timing
- Built-in **hls.js** player with autoplay after manifest parse
- Copyable **Direct** CDN URL, **Proxied** localhost URL, and ready-made **VLC** / **mpv** command lines
- Signed upstream access: MD5 request-hash prefix, body signature keys, protobuf envelopes
- Stream URL construction with ROT47 decode and AES-256-CBC session token wrapping
- Minimal **m3u8** proxy: header injection, playlist rewrite, MPEG-TS passthrough, open CORS
- Pure TypeScript sources (`src/` → `dist/`), zero runtime npm packages
- Equal-height match list and player stage on desktop; list scrolls inside the rail

## How Resolution Works

End-to-end path for a single match (same order as `src/handlers/match.ts` and `src/api/client.ts`):

1. **Entry bootstrap** — `GET https://www.fctv33.com/` HTML is scanned for the site digit (for example `foth`) and the `apis-data*` host. Results are cached in process memory.
2. **Player referer** — site params (`/api/common/params`, ROT47 JSON) expose iframe player domains; the first domain becomes the CDN referer. A digit-keyed fallback list is used if needed.
3. **Geo** — `/api/user/info` protobuf yields optional country and continent for stream detail.
4. **Signatures** — `/api/common/bs` returns body-signing material for codes `0x64`–`0x69`. Live list uses `0x64`; match detail uses `0x66`.
5. **Live or detail** — signed `GET` under `/sfver{md5-prefix}{suffix}/api/match/…` with ordered query params (`matchId`, `sportType`, `language`, `stream`).
6. **Stream detail** — `/api/stream/detail` returns an obfuscated URL plus the `rb-session` response header.
7. **Token URL** — ROT47 decode, strip the leading marker, AES-encrypt the session, and assemble `https://…/token-…/….m3u8`.
8. **Playable link** — `{origin}/api/hls?url=…&referer=…` so the browser never talks to the CDN directly.

## Architecture

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web UI / curl  │────▶│  Local HTTP      │────▶│  FCTV33 entry +     │
│  hls.js player  │◀────│  :3000           │◀────│  apis-data API      │
└─────────────────┘     │                  │     └─────────────────────┘
                        │  /api/live       │                │
                        │  /api/resolve    │                ▼
                        │  /api/hls  ──────┼──────▶  CDN m3u8 + .ts
                        └──────────────────┘         (with player referer)
```

| Layer | Responsibility |
| --- | --- |
| `server/` | Node `http` server, router, static client assets |
| `handlers/` | JSON handlers for live list and match resolve |
| `api/` | Bootstrap, signed client, protobuf field parsers |
| `crypto/` | Param sort + MD5 prefix, ROT47, AES stream token |
| `proxy/` | Upstream fetch, playlist rewrite, segment relay |
| `client/` | Live sports UI, player, export fields |
| `config/` | Entry origin, path constants, signature codes, user-agent |

Request flow at the router:

| Path | Handler |
| --- | --- |
| `GET /api/live` | `handlers/live.ts` |
| `GET /api/resolve` | `handlers/match.ts` |
| `GET /api/hls` | `proxy/hls.ts` |
| everything else | `server/static.ts` (UI under `dist/client/`) |

## Web UI

The homepage is a compact live console — not a page-URL paste form.

### Layout

- **Top bar** — FCTV33 branding, live count chip, Refresh
- **Sport tabs** — horizontal filter (Football is default)
- **Match rail** — scrollable list of live fixtures with match ids
- **Stage** — title, resolve / first-frame timings, 16:9 player, export fields

On wide screens the rail height matches the player + exports block so the video stays visible while you scroll matches. On smaller screens the player stacks first and the list uses a capped height with its own scroll.

### Flow

1. The UI calls `/api/live?sportType=…` and fills the rail.
2. A click calls `/api/resolve?matchId=…&sportType=…`.
3. Timing starts immediately; resolve time freezes when JSON returns; first-frame time freezes when `<video>` fires `playing`.
4. The player attaches hls.js to `playableUrl` (or native HLS on Safari when supported).
5. Export inputs fill with Direct, Proxied, VLC, and mpv strings; each has a Copy button.

If the live list or resolve fails, an error banner appears above the workspace and the status chip switches to a failed state.

## REST API

Base URL defaults to `http://localhost:3000`. All resolve and live responses are JSON. The HLS proxy returns playlist text or binary segments.

### Overview

| Method | Path | Query | Success body |
| --- | --- | --- | --- |
| `GET` | `/api/live` | `sportType` | `{ sportType, matches }` |
| `GET` | `/api/resolve` | `matchId`, `sportType` | stream object (below) |
| `GET` | `/api/hls` | `url`, `referer` | m3u8 text or MPEG-TS bytes |

Unknown `/api/*` paths return `{ "error": "not found" }` with status `404`. Upstream failures on live/resolve use status `502` with an `error` string. Validation errors use `400`.

### List Live Matches

Returns fixtures that currently advertise streams for the given sport.

```bash
curl -s "http://localhost:3000/api/live?sportType=1"
```

```json
{
  "sportType": 1,
  "matches": [
    {
      "matchId": 4331876,
      "sportType": 1,
      "name": "Team A vs Team B"
    }
  ]
}
```

| Query | Required | Notes |
| --- | --- | --- |
| `sportType` | no | Defaults to `1` (Football). Must be a finite number. |

Empty `matches` means nothing live for that sport right now — not necessarily an API failure.

### Resolve a Match

Runs the full upstream chain and returns both the raw CDN playlist and a localhost proxied URL.

```bash
curl -s "http://localhost:3000/api/resolve?matchId=4331876&sportType=1"
```

```json
{
  "name": "Stream label",
  "matchId": "4331876",
  "sportType": 1,
  "streamUrl": "https://cdn.example/token-…/index.m3u8",
  "referer": "https://player.example/",
  "playableUrl": "http://localhost:3000/api/hls?url=…&referer=…"
}
```

| Field | Description |
| --- | --- |
| `name` | Label from the selected stream item |
| `matchId` | Echo of the request (numeric string) |
| `sportType` | Echo of the request |
| `streamUrl` | Tokenized CDN **m3u8**; needs the player referer on CDN requests |
| `referer` | Iframe player origin used as `Referer` / `Origin` |
| `playableUrl` | Local proxy URL safe for browser players and clients that cannot set headers |

| Query | Required | Notes |
| --- | --- | --- |
| `matchId` | yes | Digits only |
| `sportType` | yes | Finite number matching the live list entry |

### Proxy HLS

Fetches an upstream playlist or segment with the player referer, then either rewrites the manifest or returns segment bytes.

```bash
curl -s "http://localhost:3000/api/hls?url=<encoded-m3u8-or-ts>&referer=<player-origin>/"
```

| Query | Required | Notes |
| --- | --- | --- |
| `url` | yes | Absolute upstream playlist or `.ts` URL |
| `referer` | yes | Same player origin returned by resolve (include trailing `/` as returned) |

Behavior:

- Detects playlists via `#EXTM3U` in the body or `.m3u8` in the URL.
- Rewrites non-comment URI lines to absolute URLs that point back at `/api/hls` with the same referer.
- Serves playlists as `application/vnd.apple.mpegurl` and segments as `video/mp2t`.
- Sets `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`.
- On upstream failure returns plain-text status `502`.

## Playback

### Browser Player

The UI loads `playableUrl` with hls.js when Media Source Extensions are available. On Apple platforms that support native HLS, the video element can take the proxied URL directly. Autoplay starts after the manifest is parsed.

### Proxied Playlist

Use `playableUrl` whenever the client cannot attach custom HTTP headers (most browser players, many embed setups, simple HLS demos). All playlist and segment traffic stays on localhost and inherits the referer from the proxy.

### Direct CDN with Referer

`streamUrl` is the real tokenized playlist on the CDN. It works in players that can send headers — for example VLC and mpv — when paired with the returned `referer`. Opening `streamUrl` alone in a normal browser tab usually fails.

### VLC and mpv

After a successful resolve, the UI fills:

```bash
vlc --http-referrer '<referer>' '<streamUrl>'
mpv --referrer='<referer>' '<streamUrl>'
```

Copy either line and run it on a machine with VLC or mpv installed. Prefer `playableUrl` if you want a single URL without referer flags.

## Sport Types

Values match the upstream `sportType` field and the UI tabs.

| `sportType` | Label |
| ---: | --- |
| 1 | Football |
| 2 | Basketball |
| 3 | Tennis |
| 4 | Baseball |
| 6 | Cricket |
| 7 | Motorsport |
| 8 | Rugby |
| 9 | Am. Football |
| 11 | Hockey |
| 90 | Others |

## Stack and Scripts

| Piece | Detail |
| --- | --- |
| Runtime | Node.js ≥ 20 |
| Language | TypeScript (strict), ESM (`"type": "module"`) |
| Server build | `tsc -p tsconfig.json` → `dist/` |
| Client build | `tsc -p tsconfig.client.json` → `dist/client/` plus copied HTML/CSS |
| Runtime deps | None |
| Dev deps | `typescript`, `@types/node` |
| Player | hls.js from jsDelivr in `index.html` |

```bash
npm start        # build, kill stale listeners on PORT, run the server
npm run build    # compile server + client assets only
npm run typecheck
```

Source maps are disabled. The listen URL is the only startup log line.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port for the UI and API |

Entry origin, API paths, signature codes, and user-agent live in `src/config/site.ts`. Stream AES key material lives in `src/crypto/stream-token.ts` (derived from the public client bundle constants).

## Source Layout

```text
src/
  api/
    bootstrap.ts    # entry HTML → digit + apis-data base URL
    client.ts       # signed live/detail/stream client
    protobuf.ts     # envelope, live list, match/stream detail parsers
  crypto/
    request-hash.ts # param order + MD5 prefix for /sfver…
    rot47.ts        # ROT47 helper
    stream-token.ts # AES tokenized CDN URL
  handlers/
    live.ts         # GET /api/live
    match.ts        # GET /api/resolve
  proxy/
    hls.ts          # GET /api/hls
  server/
    main.ts         # http.createServer
    router.ts       # path dispatch
    static.ts       # dist/client assets
  client/
    app.ts          # live UI + hls.js wiring
    index.html
    styles.css
  config/
    site.ts         # origins, paths, signatures, UA
```

## Common Issues

| Symptom | Likely cause |
| --- | --- |
| Live list empty | No streams for that sport at the moment; try another tab or Refresh |
| Resolve `502` | Upstream signature, geo, or stream detail failure — check the JSON `error` string |
| Browser plays black / errors | Prefer `playableUrl`; Direct CDN URLs need referer the browser cannot set |
| VLC/mpv fail on Direct | Confirm the copied `--http-referrer` / `--referrer` matches resolve `referer` |
| Port already in use | `npm start` tries to free `PORT`; otherwise set `PORT=8080` |
| Bootstrap errors | Entry page HTML shape changed; bootstrap regex in `api/bootstrap.ts` may need an update |

## Disclaimer

This project is for personal learning and local experimentation with HLS resolution, signed API clients, and referer-aware m3u8 proxying. Respect the terms of service and copyright of any upstream content provider. You are responsible for how you use the software.
