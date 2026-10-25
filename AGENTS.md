# AGENTS.md

Working instructions for AI agents and contributors on NITC live in
**[CLAUDE.md](CLAUDE.md)** (canonical).

Quick reminders:
- Read-only map for Netgress; never add game actions.
- Game model = classic Ingress (pre-Prime): mechanics are 100% faithful to the
  original. A gap or difference from that original is a likely bug, not a feature.
- Secrets (tokens, passwords, `login.json`) are gitignored — never commit or log them.
- Cite only the official contract `docs/NETGRESS_MAP_API.md`; keep the focus on our
  own modern map and UI/UX.
- Respect the API budget: debounce, abort stale requests, ETag/304, honor `Retry-After`.
