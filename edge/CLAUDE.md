# Recorder box — (Node + ffmpeg, `edge/`)

## ⚠️ Before writing any code in `edge/`, load the `edge-conventions` skill

The conventions are **non-negotiable** and live in that skill
([`.claude/skills/edge-conventions/`](../.claude/skills/edge-conventions/SKILL.md)): the module
layout, the device API contract and how each error is handled, the ffmpeg rules (stream-copy
recording, never re-encode the ring buffer, mask RTSP credentials), segment timing, the
User-Agent rule, and the verification commands. Read it **before** writing, not after.

## Stack

Node 20.12+ · plain JavaScript (ESM, no TypeScript) · **no runtime dependencies** (global `fetch`,
`FormData`, `fs.openAsBlob`, `child_process.spawn`) · ffmpeg 5+ · pm2 · `node:test`.

## Commands (run in `edge/`)

```bash
npm start        # needs .env (API_URL, PAIRING_CODE until paired) — copy .env.example
npm run lint     # verification, 1 of 3
npm test         # verification, 2 of 3 — no network, no ffmpeg needed
npm run smoke    # verification, 3 of 3 — ~2 min, needs ffmpeg; no API, no camera
```

The server side of the box lives in `back/` (`controllers/v1/device/`); changing it is backend
work and follows `backend-conventions`. Plans, change requests, bug reports and the changelog are
shared with the whole repo and live in the repo-root [`docs/`](../docs/README.md).
