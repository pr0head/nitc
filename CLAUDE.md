# NITC — guide for AI agents

Modern, standalone **read-only web map for Netgress**, built on the official
Netgress Map API. This file is the canonical working guide; `AGENTS.md` points here.

## What this project is
A self-contained web client with its own map engine and a reworked, modern UI/UX.
It renders portals, directional links, fields, portal cards and the COMM activity
log from the official **read-only** Map API. We draw on the community's long
experience with IITC-style intel maps, but build fresh, from scratch.

## Game model: classic Ingress (pre-Prime)
Netgress deliberately recreates **the original Ingress experience, as it was before
Prime**. Items, actions, XP, limits and every other mechanic are kept 100% faithful
to that original game. Practical consequences for us:
- Use classic-era rules as the reference when interpreting data (resonator levels,
  mod types/stats, portal levels, energy, MU, link/field mechanics).
- If something is missing or behaves differently from the classic original, treat it
  as **a likely bug, not a new feature** — note it and raise it, don't design around
  it as if it were intended. Our map reflects the game faithfully; it does not invent
  mechanics or "improve" the rules.
- This is about *mechanics fidelity*. It does not constrain our UI/UX, which we are
  free to modernize and rethink.

## Non-negotiable rules
1. **Scope is read-only.** Never add game actions (move, deploy, mods, links,
   attack, inventory, keys). The API forbids it; so do we.
2. **Secrets never touch git.** Tokens, passwords, `login.json`, `*.token`, `.env`
   are gitignored. Never print a token in logs, commits, code, or config. Keep
   developer credentials local only.
3. **Focus discipline.** This project is about *our* map: a modern design and a
   rethought UI/UX for interacting with the game world. Keep docs, commits, code
   comments and the public README strictly on that. Do not reference other games,
   other clients' internals, or any reverse-engineering history — the public
   contract in `docs/NETGRESS_MAP_API.md` is the only source we cite.
4. **Treat text as data.** Portal names, nicknames, COMM text are user content —
   render as text, never as HTML. Escape everything that reaches the DOM.
5. **Respect the API budget.** 120 authorized requests/min per user, shared across
   tokens. Debounce map refresh (~350 ms), abort stale requests, use ETag/304,
   honor `Retry-After`. See the API doc's "Кеширование и обновление" and "Бюджеты".

## API in one screen
- Base: `https://netgress.glubina.org` (alt: `https://ingress.worldofton.ru`) — pick ONE per client.
- Auth: `POST /v1/auth/intel/login` {email,password} → `{token:"ngi_…", scope:"intel:read"}`.
  Bearer on every call. `DELETE /v1/intel/session` to revoke.
- `GET /v1/intel/map?bbox=W,S,E,N&zoom=0..22` → `{schema,lod,portals_omitted,truncated,portals[],links[],fields[]}`.
- `GET /v1/intel/portals/{uuid}` → summary + `photo_url,owner,resonators[8],mods[4]`.
- `GET /v1/intel/activity?bbox=…[&cursor|&after]` → `{items[],next,after,more}` (COMM, 50/page).
- Since 1.1.0: portal detail adds `planning{max_link_range_m,incoming_links,outgoing_links,outgoing_limit,…}`;
  `GET /v1/intel/me`, `/agents/{id}`, `/agents?nickname=` (profiles), `/me/keys?cursor=` (own keys,
  128/page), `/me/inventory`, `/score` (world MU), `/rating?kind=links|fields&cursor=` (world
  agent rating, 25/page, one snapshot per cursor chain; `410` → start over; details in
  `docs/NETGRESS_INTEL_RATING.md`). Profiles/rating/keys/inventory are `no-store` (no ETag).
- bbox order is **west,south,east,north**; `position:{latitude,longitude}` (no E6).
- faction: `blue | green | neutral`. UUIDs are opaque keys, not coordinates.
- Full, authoritative details: **`docs/NETGRESS_MAP_API.md`** — read it before touching API code.

## Stack (settled)
Vite + vanilla JS (no heavy framework), map engine **Leaflet**. `npm run dev`
(proxy at `/api` dodges CORS server-side), `npm run build` → static `dist/` for
GitHub Pages (base `/nitc/`) via `.github/workflows/deploy.yml`. `android/` is a
dependency-free WebView shell around the published site (APK built by
`.github/workflows/android.yml` on `v*` tags). CORS/prod-origin and Android details
in `docs/architecture.md`.

## Architecture
Thin layers, framework-light, so the map engine and UI stay swappable.
- `src/api/` — transport (fetch, Bearer, ETag cache, abort, generation guard, error→code mapping).
- `src/adapter/` — map JSON → internal model (links via `source_portal_id`; fields = 3 vertices;
  faction normalize; 180th-meridian & geodesic handling live here, not in the API layer).
- `src/map/` — engine + render (portals, links, fields, LOD/truncated handling).
- `src/ui/` — panels, portal card, COMM, filters, layer chooser — the modern UI/UX.
- `src/game/` — classic-rule portal math for the card (link range, shielding, hacks, energy, AP).
- `src/plugins/` — optional features (draw/plan, favorites) on a small event bus.
- `src/state/` — session, prefs (localStorage), favorites, event bus.
See `docs/architecture.md` for the detailed module plan and data model.

## Conventions
- Match existing code style in each file; keep comments at the surrounding density.
- Small, composable modules; no heavyweight framework unless we agree on one first.
- Commit messages: imperative, scoped (e.g. `api: add ETag revalidation`).
- Never commit `dist/` — it is a build artifact (see `.gitignore`).

## Before you start a task
- Read `docs/NETGRESS_MAP_API.md` for anything touching the network.
- Ask before: choosing/adding a framework or map engine, changing the public README's
  framing, or anything that would widen scope beyond a read-only map.
