---
name: mobile-conventions
description: The non-negotiable conventions for the Expo React Native app in app/ (app/src, app/App.js) — a Dyna Cam session device paired to one recording session with a 6-digit key — file naming, exports and imports, the library set, the services/api + services/requests split, React Query keys and invalidation, demo mode, the SQLite tables/endpoints/migrations layering, Zustand stores, navigation constants, NativeWind theme tokens and font families, the list-module pattern, the app's architecture and its traps. Load BEFORE writing or editing anything under app/ — any screen, hook, component, sheet, service, store, table, route, app.json or Metro/Tailwind/Babel config. Also load when reviewing app code, answering how the mobile app is structured, or deciding where a new file goes. Not for front/ (that is frontend-conventions).
---

# Mobile conventions (`app/`)

Expo SDK 58 · React Native 0.88 · React 19 (hooks only) · JavaScript, no
TypeScript · React Native Reusables on NativeWind (Tailwind v3) ·
lucide-react-native · Zustand · TanStack React Query 5 · axios · expo-sqlite ·
React Navigation 7 (native stack).

The app is a Dyna Cam **session device** (PLAN-002 Phase E): staff book a
session on the web and pair a phone or tablet to THAT session with a 6-digit
key. It shows the session — live video from the venue's recorder box, the
download QR, a timer, Stop recording — then the QR with saving progress, and
unpairs itself. There is **no sign-in and no staff-account app**: staff work
happens on the web. Its only API is `/api/v1/pair/app` and `/api/v1/app/*`.
Every path below is relative to `app/` unless it says otherwise.

These rules are **non-negotiable** unless the user says otherwise. Reference
implementations: `src/Screens/Pair/` for a standalone form screen,
`src/Screens/Session/` for a polled, responsive screen (side by side on a
landscape tablet, stacked on a phone) — copy their shape.

## Read the doc for the area you're touching

Read it **before** writing code, not after. Read more than one when the work
spans areas (a new module touches all of them).

| Doc | Read it when |
| --- | --- |
| [architecture-and-traps.md](references/architecture-and-traps.md) | **Always read first.** Commands and the verification loop, the api/requests split, local DB layering, navigation, theming, typography, demo mode, and the traps (Tailwind `content`, Reanimated warning, `@/` alias, `EXPO_PUBLIC_*`, deps that look unused). |
| [engineering-checklist.md](references/engineering-checklist.md) | **Any code change.** Reuse first, fetch and render cost, layout at 320px and on a tablet, the loading/empty/error states, accessibility. §10 lists the app's known gaps. |
| [project-structure.md](references/project-structure.md) | Creating a file or deciding where one goes; looking for an existing component (screen chrome, form fields, the `pattern/` module kit, RNR primitives) before writing a new one. |
| [code-conventions.md](references/code-conventions.md) | **Always.** Naming, exports, imports, the library set, where state lives, error handling, the RN rendering traps. |
| [data-layer.md](references/data-layer.md) | Touching `services/api/`, `services/requests/`, a React Query hook, demo mode, a Zustand store, or `store/database/`. |
| [design-guidelines.md](references/design-guidelines.md) | Any screen markup — tokens, dark mode, typography, icons, spacing, the screen checklist. |
| [module-pattern.md](references/module-pattern.md) | A list screen or create/edit sheet. For a whole new module, use the **`new-mobile-module`** skill, which drives this one. |
| [migrations/README.md](../../../app/src/store/database/migrations/README.md) | Changing a SQLite table that may already exist on someone's device. |

## Rules that are violated most often

Load the relevant doc for the detail; these are the ones worth knowing cold.

- **Never hardcode a hex.** Colour is a Tailwind class bound to a token in
  `global.css`. The only exceptions are the status set (`#2E7D32`, `#E65100`,
  `#E53935`) and `#fff`/`#000` on a known brand surface.
- **APIs that take a colour string** (lucide `color`, svg fills, `StatusBar`,
  tab-view styles) use `useThemeColors()`. A colour changed in `global.css`
  must be changed in `src/lib/theme.js` too.
- **The primary button is inverted monochrome** — the default `<Button>`. Never
  pass it a background, never make a button green. Green is for ticks, dots,
  focus rings and chips.
- **Pick the font family, not the weight.** `font-sans-semibold`, never
  `font-semibold` — React Native has no synthetic weights.
- **`transition-*` / `animate-*` only inside `Platform.select({ web: … })`.**
  On native they trigger a Reanimated warning on every render.
- **A file outside `./App.js` or `./src/**` gets no styles at all.** Tailwind
  only compiles classes from its `content` globs.
- **Screens import from `services/requests/` only.** `api/` returns
  `response.data` and nothing else; toasts, store writes and invalidation live
  in `requests/`.
- **The API wraps every response** as `{ success, message, data: { … } }` (see
  the repo-root `CLAUDE.md`). `api/` returns `response.data` (the envelope);
  `requests/` and screens read `.data.<entity>` from it.
- **Never fetch in `useEffect`.** Use `useQuery`, with every input in the key:
  `["items", { page, search, status }]`.
- **Read Zustand with a selector** — `useStore((s) => s.field)`, never
  `useStore()`.
- **Navigate with `SCREEN_NAVIGATION` constants**, never a string literal.
  Today the app's three screens (Pair, Session, Ended) are switched by the
  navigator itself, from the pairing and the session's state — nothing
  navigates by hand. A pushed screen's `ScreenHeader` gets `onBack` because
  the stack has no header.
- **`DataList` is a `FlatList`.** Never nest it in a `ScrollView`; put headers
  and stat cards in `ListHeaderComponent`.
- **`cond ? <X/> : null`, not `cond && <X/>`, when `cond` can be `0` or a
  string.** A stray `0` outside `<Text>` throws on native.
- **Shared components take `className` and merge it with `cn()`**, and read the
  theme themselves — never a `colors` prop.
- **`useWindowDimensions()`, never `Dimensions.get()`** — the latter misses
  rotation and split-screen.
- **Dependencies go in with `npx expo install <pkg>`** (run inside `app/`), so
  you get the version SDK 58 pins. A package with native code needs a new dev
  build before it runs.
- **RNR components come from the CLI** into `src/components/ui/`. Re-adding
  `switch.jsx` with `--overwrite` undoes its local fix.
- **Phone is always `09XX XXXX XXX`** with the example `0912 3456 789` as the
  hint, same as the web app and the API. The app has no phone field today;
  if one comes back, port `front/src/utils/phoneFormat.js` (without zod).
- **One credential: the device's pairing token.** `usePairedStore` keeps it
  in **expo-secure-store**, never AsyncStorage; the device axios instance
  sends `Authorization: App <token>` (no Bearer, CSRF or refresh). It is
  cleared **only** by a 401 `TOKEN_INVALID`, Done, or the unpair countdown —
  never by a network error or a 5xx. See architecture-and-traps.md.
- **Never log a secret.** Not the token, not POST /pair/app's response, not
  an axios error (its `config.headers` holds the token), not `live.hlsUrl`
  (its `sig` is a signature).
- **API timestamps are Manila wall-clock strings** with no zone. Format them
  with `utils/dynaCam.js` (`formatTime`), never `new Date(str)` — Hermes
  misparses the space-separated form and a Date shifts it into the device's
  zone. **Running timers tick from the API's "…Seconds" values** plus the
  time since the response (`TickingTimer`), never from the device clock
  against an API time.
- **Live video is `expo-video`, playing HLS from the recorder box** over
  plain HTTP on the LAN (`LivePanel`). Keep its source stable across polls
  (`useLiveSource`); swapping the source restarts the video.

## Related

- The **`new-mobile-module`** skill scaffolds an admin-style list/detail
  module. The session device has none today (no Menu tab, no staff sign-in),
  so read that skill's status note before using it.
- Verification (run in `app/`) is `npx expo-doctor@latest` and
  `npx expo export --platform android --clear`. There is no test runner, linter
  or formatter; don't invent `npm test`.
- The "Modern" design system is shared with `front/`; its web tokens live in
  `front/src/index.css` (see `frontend-conventions`). Keep the two in step.
- When a change that ships is finished, the **`changelog`** skill queues it for
  the next release. Plans, CRs and bug reports live in the repo-root `docs/`.
