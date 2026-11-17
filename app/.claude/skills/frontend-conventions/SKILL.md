---
name: frontend-conventions
description: The non-negotiable conventions for this Expo React Native app (src/, App.js) — file naming, exports and imports, the library set, the services/api + services/requests split, React Query keys and invalidation, demo mode, the SQLite tables/endpoints/migrations layering, Zustand stores, navigation constants, NativeWind theme tokens and font families, and the list-module pattern. Load BEFORE writing or editing anything under src/ or App.js — any screen, hook, component, sheet, service, store, table, or route. Also load when reviewing app code, answering how the app is structured, or deciding where a new file goes.
---

# Frontend conventions (`src/`)

Expo SDK 58 · React Native 0.88 · React 19 (hooks only) · JavaScript, no
TypeScript · React Native Reusables on NativeWind (Tailwind v3) ·
lucide-react-native · Zustand · TanStack React Query 5 · axios · expo-sqlite ·
React Navigation 7 (native stack).

These rules are **non-negotiable** unless the user says otherwise. Reference
implementations: `src/Screens/Login/Index.js` for a standalone screen,
`src/Screens/Example/` for a list/detail module — copy their shape.

## Read the doc for the area you're touching

Read it **before** writing code, not after. Read more than one when the work
spans areas (a new module touches all of them).

| Doc | Read it when |
| --- | --- |
| [ENGINEERING_CHECKLIST.md](../../../docs/ENGINEERING_CHECKLIST.md) | **Any code change.** Reuse first, fetch and render cost, layout at 320px and on a tablet, the loading/empty/error states, accessibility. §10 lists the repo's known gaps. |
| [code-conventions.md](references/code-conventions.md) | **Always.** Naming, exports, imports, the library set, where state lives, error handling, the RN rendering traps. |
| [data-layer.md](references/data-layer.md) | Touching `services/api/`, `services/requests/`, a React Query hook, demo mode, a Zustand store, or `store/database/`. |
| [DESIGN_GUIDELINES.md](../../../docs/DESIGN_GUIDELINES.md) | Any screen markup — tokens, dark mode, typography, icons, spacing, the screen checklist. |
| [MODULE_PATTERN.md](../../../docs/MODULE_PATTERN.md) | A list screen or create/edit sheet. For a whole new module, use the **`new-module`** skill, which drives this one. |
| [migrations/README.md](../../../src/store/database/migrations/README.md) | Changing a SQLite table that may already exist on someone's device. |

The repo-root `CLAUDE.md` is always loaded and holds the traps; this skill does
not repeat them in full.

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
- **Never fetch in `useEffect`.** Use `useQuery`, with every input in the key:
  `["items", { page, search, status }]`.
- **Read Zustand with a selector** — `useStore((s) => s.field)`, never
  `useStore()`.
- **Navigate with `SCREEN_NAVIGATION` constants**, never a string literal. A
  module is a row under the Menu tab, not a new tab, and its `ScreenHeader`
  gets `onBack` because the stack has no header.
- **`DataList` is a `FlatList`.** Never nest it in a `ScrollView`; put headers
  and stat cards in `ListHeaderComponent`.
- **`cond ? <X/> : null`, not `cond && <X/>`, when `cond` can be `0` or a
  string.** A stray `0` outside `<Text>` throws on native.
- **Shared components take `className` and merge it with `cn()`**, and read the
  theme themselves — never a `colors` prop.
- **`useWindowDimensions()`, never `Dimensions.get()`** — the latter misses
  rotation and split-screen.
- **Dependencies go in with `npx expo install <pkg>`**, so you get the version
  SDK 58 pins. A package with native code needs a new dev build before it
  runs.
- **RNR components come from the CLI** into `src/components/ui/`. Re-adding
  `switch.jsx` with `--overwrite` undoes its local fix.

## Related

- Building a whole new list/detail module? Use the **`new-module`** skill — it
  drives this one in the right order.
- Verification is `npx expo-doctor@latest` and
  `npx expo export --platform android --clear`. There is no test runner, linter
  or formatter; don't invent `npm test`.
- When a change that ships is finished, the **`changelog`** skill queues it for
  the next release.
