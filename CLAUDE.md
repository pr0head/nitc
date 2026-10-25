# NITC — guide for AI agents

Modern, standalone **read-only web map for Netgress**, built on the official
Netgress Map API. This file is the canonical working guide; `AGENTS.md` points here.

## What this project is
A self-contained web client with its own map engine and a reworked, modern UI/UX.
It renders portals, directional links, fields, portal cards and the COMM activity
log from the official **read-only** Map API. We draw on the community's long
experience with IITC-style intel maps, but build fresh, from scratch.

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
- bbox order is **west,south,east,north**; `position:{latitude,longitude}` (no E6).
- faction: `blue | green | neutral`. UUIDs are opaque keys, not coordinates.
- Full, authoritative details: **`docs/NETGRESS_MAP_API.md`** — read it before touching API code.

## Architecture (target)
Thin layers, framework-light, so the map engine and UI stay swappable.
- `src/api/` — transport (fetch, Bearer, ETag cache, abort, generation guard, error→code mapping).
- `src/adapter/` — map JSON → internal model (links via `source_portal_id`; fields = 3 vertices;
  faction normalize; 180th-meridian & geodesic handling live here, not in the API layer).
- `src/map/` — engine + render (portals, links, fields, LOD/truncated handling).
- `src/ui/` — panels, portal card, COMM, filters, layer chooser — the modern UI/UX.
- `src/plugins/` — optional features (draw/plan, favorites, highlighters) on a small event bus.
- `src/state/` — session, viewport data, prefs (localStorage), selection.
See `docs/architecture.md` for the detailed module plan and data model.

## Conventions
- Match existing code style in each file; keep comments at the surrounding density.
- Small, composable modules; no heavyweight framework unless we agree on one first.
- Commit messages: imperative, scoped (e.g. `api: add ETag revalidation`).
- Do not commit `dist/` build artifacts until the build is agreed (see `.gitignore`).

## Before you start a task
- Read `docs/NETGRESS_MAP_API.md` for anything touching the network.
- Ask before: choosing/adding a framework or map engine, changing the public README's
  framing, or anything that would widen scope beyond a read-only map.
