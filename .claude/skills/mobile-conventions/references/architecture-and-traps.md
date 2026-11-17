# Mobile app: architecture and traps

How the Expo app in `app/` — a Dyna Cam session device — is put together, and the traps that bite. Paths
are relative to `app/` unless they say otherwise. (This was `app/CLAUDE.md` before
the app's docs moved into the `mobile-conventions` skill.)

> **Read [engineering-checklist.md](engineering-checklist.md) before writing
> code.** It is the standing bar for every change here: reuse what exists, what
> a fetch and a render cost, layout down to 320px and up to a tablet, and the
> loading/empty/error states a screen owes. §10 lists the app's measured gaps.
> Visual rules are in [design-guidelines.md](design-guidelines.md); list-module
> structure is in [module-pattern.md](module-pattern.md).

## What the app is

A Dyna Cam **session device** (see `docs/plans/PLAN-002-setup-menu-device-pairing/`
§5 at the repo root): a phone or tablet at the court, paired to ONE recording
session with a 6-digit key that staff create on the web. It started as an
Expo SDK 58 / React Native 0.88 starter, in plain JavaScript (no `.tsx`). UI
is [React Native Reusables](https://reactnativereusables.com) on NativeWind
(Tailwind v3).

```
Pair this device ──key──▶ Session ──Stop / end time / web End──▶ Ended ──Done / 10 min──▶ Pair
                          live video · QR · REC timer · Stop       QR · saving progress · countdown
```

Consequences for how you work here:

- **There is no sign-in.** PLAN-001 Phase 6 and PLAN-002 Phases C–D built a
  staff-account app (Courts, Clips, Sessions, Take payment, Recorder boxes,
  Dashboard, a venue-wide paired mode); Phase E removed all of it — staff work
  happens on the web. Git history has it (up to `0fec6f7`) if it is ever
  needed again.
- There are no local SQLite tables; the layer stays wired for the first
  offline feature. `constants/demo.js` backs demo mode — every request hook
  has a fixture branch, so the whole app runs with `EXPO_PUBLIC_DEMO_MODE=true`.
- Several files under `src/` are unreachable from `index.js` **by design** —
  the template's kit: most of `components/pattern/`, `ScreenHeader`,
  `GroupedList`, `StyledInput`, `AnimatedField`, `DateRangePicker`,
  `LoadingScreen`, `useCamera`, the generic `utils/*`, and any
  `components/ui/*` not yet used on a screen. They're a kit to build with.
  "Unused" is not a defect here — but code written for a feature leaves with
  the feature.
- Doc comments carry more weight than usual. Match the existing density rather
  than trimming them.

## Commands

Run these inside `app/`:

```bash
npm start              # expo start --clear
npm run android        # expo run:android  (needs a prebuild + native toolchain)
npm run ios
npm run web
```

**There is no test framework, linter or formatter configured.** No jest, no
eslint, no prettier. Do not invent `npm test` — it does not exist. The actual
verification loop is:

```bash
npx expo-doctor@latest                      # 20/20 expected
npx expo export --platform android --clear  # the real check: does it bundle?
```

`expo export` catches missing modules, broken imports and Metro config
problems without a device. **Read its asset list** — see the icon-font trap
below. TypeScript is installed and `tsconfig.json` includes `**/*.js` with
`strict: false`, so `npx tsc --noEmit` gives loose type checking, but the code
is not written to satisfy it.

Native folders are generated, never committed:

```bash
npx expo prebuild --clean --platform android
```

## Skills and project docs

Skills live in the repo-root `.claude/skills/`. `mobile-conventions` (this
skill) loads before any change under `app/`; `new-mobile-module` scaffolds a
screen module. Plans, change requests, bug reports and the changelog are
shared with the rest of the repo and live in the repo-root `docs/` (see its
`README.md`); `/publish` bumps the app's version together with `front/` and
`back/`.

## Architecture

### `services/api/` vs `services/requests/` — the central convention

`api/` functions take a payload, make the call, return `response.data`. Nothing
else — no toasts, no store writes, no navigation. `requests/` wraps them in
`useQuery`/`useMutation` and owns every side effect. **Screens only ever import
from `requests/`.**

Demo mode's bypass lives in `requests/`, not `api/`, for this reason: `api/`
describes the server, and a fake session is not something the server does.

### Local database layering

`store/database/` splits three ways, one file per table in each:

- `tables/*.table.js` — `CREATE TABLE IF NOT EXISTS`, runs on every startup
- `endpoints/*.endpoints.js` — one SQL statement per function, all named `db_*`
- `migrations/` — numbered, run once, tracked in a `migrations` table

**Initial schema belongs in `tables/`, not a migration.** Migrations are only
for changing a schema already installed on someone's device. New tables must be
registered in `initDatabase.js`.

The `db_` prefix exists so a call site reads unambiguously as a local hit
rather than a network request.

### Navigation

`Navigation/index.js` swaps the **entire navigator** on the device's state
rather than pushing a screen, so an unpaired device cannot be navigated back
into a session:

1. no pairing token (`usePairedStore.token`) → `Screens/Pair/`
2. paired, the session not over → `Screens/Session/`
3. paired, the session over — `GET /app/session` returns a non-null
   `unpairInSeconds` (its 10-minute grace) → `Screens/Ended/`

The session query (polled every 5 s) is read in Navigation too, so the switch
to Ended follows the first answer that says it's over — Stop on this device,
the end time, or staff ending it on the web. Nothing renders until
`usePairedStore.hydrated` (the secure store is read asynchronously); `App.js`
holds the splash until then, so a paired device never flashes the Pair screen.

### The one credential

| | Session device |
| --- | --- |
| Store | `usePairedStore` (**expo-secure-store**, key `paired-app`, persist `version` 1) |
| API | `POST /api/v1/pair/app` to pair (no auth); `/api/v1/app/*` after |
| Header | `Authorization: App <token>` — no Bearer, no CSRF, no refresh |
| axios | `axiosPair` (no credentials) and `createDeviceAxiosInstance()` |
| Ends when | a 401 `TOKEN_INVALID` (grace over, session cancelled, unpaired on the web), **Done**, or the unpair countdown reaching 0 |

A device must **never unpair on a network error or a 5xx** — those show
`components/ConnectionBanner` ("Can't reach Dyna Cam — retrying") while the
session poll keeps going. The token, `POST /pair/app`'s response and the live
link's `sig` are secrets: never `console.*` an axios error, a response, or
`live.hlsUrl` (an axios error carries `config.headers`).

### Live video

`Screens/Session/LivePanel.js` plays the court through **`expo-video`**: an
HLS playlist served by the venue's recorder box over **plain HTTP on the
LAN** (`http://<box IP>:8090/live/<courtId>/index.m3u8?exp=…&sig=…`, about
5 s behind). Things that matter:

- `live` is null when the session isn't recording, the box is offline or has
  no LAN address — show the calm "Live view needs the venue Wi-Fi" panel;
  recording is never affected.
- The link is signed and expires (~15 min); the 5-second session poll brings
  fresh ones. `useLiveSource` keeps the player's source **stable** — it only
  swaps when the stream's host/path changes or the playing link is within
  2 minutes of expiry — because every swap restarts the video.
- Plain HTTP to a LAN IP needs `usesCleartextTraffic` (Android, via
  `expo-build-properties`) and `NSAllowsLocalNetworking` plus the Local
  Network usage text (iOS) in `app.json`. These are native config: a new dev
  build.

### The player's own stream (PLAN-002 Phase G)

A player can stream their session to their own Facebook / YouTube. The
device never sees the stream key: "Stream to your Facebook / YouTube" asks
`POST /app/session/stream-link` for a short-lived setup link and shows it as
a QR the **player** scans; they paste the key on that page (in `front/`).

- The link is a **mutation, never a query** — every call kills the previous
  code, so it runs only when the sheet opens or on "New code".
- The sheet closes by itself when `GET /app/session` reports the stream (a
  different one, for "Change stream"); `stream.status` (waiting / starting /
  live / error) shows as a one-line `StreamChip` under the header.
- Streaming is secondary: its buttons sit under Stop recording and never
  compete with it. The Ended screen has no stream UI — the API stops it.
- The link's code is a credential — never log `url`.

Route
names live in `constants/navigations.js` as `SCREEN_NAVIGATION` — navigate with
the constant, never a string literal.

### UI — React Native Reusables + NativeWind

RNR is **not a dependency**. It is a shadcn-style CLI that copies component
source into `src/components/ui/` as files you own:

```bash
npx @react-native-reusables/cli@latest add <name> --yes --styling-library nativewind
```

Its `doctor` reports three false positives here — it expects Expo Router's
`app/_layout.tsx` and `.ts` files at different paths. Setup is correct.

`src/components/ui/` is generated; `src/components/` is hand-written
composition. Both take `className` and merge it via `cn()` so callers can
override.

### Theming — read this before touching colors

- Colour is **Tailwind classes bound to CSS variables**. Tokens live once in
  `global.css` (`:root` light, `.dark:root` dark) and map to classes in
  `tailwind.config.js`. Use `bg-primary`, `text-muted-foreground`,
  `border-border` — never hardcoded hex.
- Tokens are declared with `<alpha-value>`, which is what makes the slash
  modifier work: `bg-primary/90`, `bg-destructive/10`.
- **`src/lib/theme.js` duplicates `global.css` on purpose.** CSS custom
  properties cannot be read from JS at runtime, but some APIs take colour
  *strings* and cannot take a class — lucide `color` props, `react-native-svg`
  fills, `StatusBar`, and `react-native-tab-view` style objects. Those use
  `useThemeColors()`. **Change a colour in one file and you must change it in
  the other.** There is no automation preventing drift.
- **Dark mode is class-based and driven by the app, not the OS.**
  `tailwind.config.js` sets `darkMode: "class"` and `App.js` calls NativeWind's
  `colorScheme.set()` from `useThemeStore`. Never use React Native's
  `useColorScheme()` — it reports the device and will desync from the toggle.
- Hardcoded hex is banned except the status set (success `#2E7D32`, warning
  `#E65100`, danger `#E53935`) — the token set has no semantic success/warning
  role and these must read identically in both themes.

The palette is the "Modern" system: monochrome zinc surfaces with a single green
accent. **`primary` is inverted** — near-black in light mode, near-white in dark
— and is the button colour. **Green is never a button**; it is only for section
ticks, status dots, focus rings and chips.

### Typography — the weight trap

Fonts are Onest + JetBrains Mono, loaded in `hooks/useAppFonts.js`. React Native
has **no synthetic weights**: each weight is a separately loaded family, so
Tailwind's `font-bold` / `font-semibold` utilities do nothing on their own. Use
the family classes — `font-sans`, `font-sans-medium`, `font-sans-semibold`,
`font-sans-bold`, `font-mono`. They are named that way to avoid colliding with
Tailwind's weight utilities.

Import fonts from their **per-weight subpath**
(`@expo-google-fonts/onest/600SemiBold`). The package root `require`s all nine
weights and ships ~576KB of unused `.ttf`.

### List/detail modules

`components/pattern/` is a kit for admin-style screens — header, stat row,
searchable card list, create/edit sheet. The session device has no such
screens today; [module-pattern.md](module-pattern.md) describes the pattern
for when it does (and what changed from the web original: table → card
list, drawer → full-screen sheet).

`DataList` is a `FlatList`. Never nest it in a `ScrollView` — put headers in
`ListHeaderComponent`.

[design-guidelines.md](design-guidelines.md) is the full spec. `Screens/Pair/` is the
reference for a standalone form screen, `Screens/Session/` for a polled,
responsive screen.

### Demo mode

`EXPO_PUBLIC_DEMO_MODE=true` makes every request hook resolve locally with
zero network calls: any 6-digit key pairs (000000 answers like a wrong key)
to a session recording since 3 minutes ago, with no live video; Stop →
Processing → Ready after ~8 s, then the 10-minute countdown. Demo returns the
**same response shape** as the real API, so `onSuccess` and every screen need
no branch. Keep it that way when adding API surface.

## Traps

**Tailwind classes only exist if the file is in `content`.** `tailwind.config.js`
scans `./App.js` and `./src/**/*`. A component outside those globs renders with
**no styles at all** and no error — the class string is simply never compiled.

**Never let a `transition-*` or `animate-*` class reach native.** Keep them
inside `Platform.select({ web: ... })`, which is what RNR does everywhere except
one spot. On native those classes make NativeWind's engine read a Reanimated
shared value during React render, and Reanimated 4 strict mode logs
`[Reanimated] Reading from 'value' during component render` on every state
change. It is `__DEV__`-only and harmless in production, but it is noisy and
cannot be fixed by upgrading — `nativewind@4.2.7` and
`react-native-css-interop@0.2.7` are the latest stable (v5 is still an RC), and
0.2.7 did not touch `processTransition`.
`src/components/ui/switch.jsx` carries a local fix for exactly this; re-adding
that file with the CLI's `--overwrite` will undo it.

**`@/` resolves through tsconfig `paths`, handled by Expo's Metro.** There is no
babel module-resolver. If aliases stop resolving, check `tsconfig.json` paths
rather than looking for a babel plugin.

**`EXPO_PUBLIC_*` is inlined at build time, not read at runtime.** A release
build made with `EXPO_PUBLIC_DEMO_MODE=true` ships with auth permanently
bypassed and no runtime toggle can undo it.

**Dependencies that look unused but are not:** `react-native-pager-view`
(tab-view peer), `react-native-screens` (native-stack peer),
`react-native-reanimated` + `react-native-worklets` (babel plugin / peer),
`babel-preset-expo` (babel config), `expo-dev-client` (build-time),
`tailwindcss-animate` (tailwind plugin), `react-dom` + `react-native-web`
(`@rn-primitives/*` peers — without them hoisted, npm installs nested copies
and expo-doctor fails on duplicate native modules). Grep finds zero direct
imports for most of these.

**`android/` and `ios/` are gitignored.** They were committed once and silently
overrode `app.json`'s bundle ID. Regenerate with `prebuild`; never commit.
