# Player app — (React 19 + Vite) · PLAN-009

The players' own app: find a venue, book and pay, see your games, keep your profile. Later phases
of [PLAN-009](../docs/plans/PLAN-009-player-app-pickleball/plan.md) add Open Play, the queue,
tournaments, clubs and coaching. Staff work stays in the main app's Admin portal (`front/`).

## ⚠️ Before writing any code in `web-app/src`, load the `frontend-conventions` skill

The same conventions as `front/` apply (code style, service layers, React Query keys, design
tokens, forms) — the skill's `references/` are the rules. What's different here:

- **No staff login, no permissions, no table pages.** Pages follow the player-page shape from
  `front/src/pages/Public/`: a `hooks.jsx` with the state and handlers, a presentational
  `index.jsx`, wrapped in `components/layout/PublicLayout.jsx` (top bar, and the
  Discover / Play / Profile tabs from `components/layout/PlayerTabs.jsx` — bottom bar on phones).
- **Two axios instances.** `services/api/axios.js` (plain, for `/api/v1/public/*` and the player
  session routes — no CSRF, the API checks it only on Admin routes) and `playerAxios` in
  `services/api/public/player.js` (`Authorization: Player <token>`, refreshes itself).
  `store/playerStore.js` keeps only the refresh token.
- **Same paths as the main app used** (`/book`, `/book/:bookingToken`, `/booking/:manageToken`,
  `/me/games`, `/me/profile`, `/signed-in`): links the API sends (emails, Xendit return, Google
  sign-in) point here once `PLAYER_APP_URL` is set in `back/.env`. A new page a sign-in should
  return to must also be added to `RETURN_ROOTS` in `back/server/src/utils/googleSignIn.js`.
- **Game, clip, stream and TV board pages stay on the main app** — link to them with full URLs
  from `utils/mainApp.js` (`VITE_MAIN_APP_URL`), never a router `<Link>`.

## Running it

`npm install`, copy `.env.example` to `.env`, `npm run dev` → http://localhost:4022. `/api/v1`
and `/public/uploads` are proxied to `VITE_API_URL` (the API on `4021`). Verify a change with
`npm run lint && npm run build`.

## Stack

React 19 (function components, hooks only) · JavaScript (no TypeScript) · Vite ·
**shadcn/ui** (in `src/components/ui/`) · Tailwind CSS v4 · Zustand · TanStack React Query ·
**react-hook-form + zod** · **sonner** · axios · react-router v8 · lucide-react · dayjs. Type is
**Onest** (UI) + **JetBrains Mono** (micro-data) + **Space Grotesk** (the wordmark), self-hosted
via `@fontsource-variable`.

## Design system

The main app's DGSports brand (CR-036): `src/index.css` is the same token file as
`front/src/index.css` — keep the two in step. Blue primary buttons with white text (lime with
dark text in dark), hairline borders instead of shadows, every colour a token — **never hardcode a
hex**. Mobile-first: one column, 44 px+ touch targets, room for the bottom tab bar.
