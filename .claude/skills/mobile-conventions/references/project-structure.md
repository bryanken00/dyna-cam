# Mobile app: project structure and component kit

Where things live in `app/src/` and which shared components to reach for before writing a new
one. Paths are relative to `app/`. (Moved here from `app/README.md`.)

## Folder layout (`app/src/`)

```
src/
├─ Navigation/        One navigator, swapped on the pairing and the session's state
├─ Screens/
│  ├─ Pair/           "Pair this device" — the 6-digit key (reference form screen)
│  ├─ Session/        Live video (LivePanel + useLiveSource), QR, REC timer, Stop,
│  │                  the player's stream (StreamChip, StreamSetupSheet + useStreamSetup)
│  └─ Ended/          Full-screen QR, saving progress, Done, unpair countdown
├─ components/        Shared UI — see the component kit below
│  ├─ ui/             React Native Reusables primitives (copied in, yours to edit)
│  └─ pattern/        The list-module kit
├─ constants/         navigation names, env-derived config, demo fixtures, version
├─ hooks/             useTheme, useAppFonts, useCustomDialog, useCamera, useNow
├─ lib/               cn() helper, JS colour mirror + NAV_THEME
├─ services/
│  ├─ api/            Pure API calls — no side effects
│  └─ requests/       React Query hooks — stores, toasts, invalidation
├─ store/             Zustand stores (+ database/)
│  └─ database/       SQLite: db wrapper, tables, endpoints, migrations
└─ utils/             Formatting, validation, error handling
```

## Component kit

**Screen chrome and forms**

| Component | Use for |
| --- | --- |
| [`ScreenHeader`](../../../../app/src/components/ScreenHeader.js) | The app's only header — title, optional back, optional actions |
| [`StyledInput`](../../../../app/src/components/StyledInput.js) | Labelled field, leading icon, focus ring, error state |
| [`GroupedList`](../../../../app/src/components/GroupedList.js) | iOS-style settings list — header + rounded card of rows |
| [`CustomDialog`](../../../../app/src/components/CustomDialog.js) | Confirm/success/error dialog (usually via `useCustomDialog`) |
| [`AnimatedField`](../../../../app/src/components/AnimatedField.js) | Fade + rise entrance; stagger siblings with `delay` |
| [`LogoMark`](../../../../app/src/components/LogoMark.js) | Gradient brand mark — swap the icon or replace it wholesale |
| [`Loading`](../../../../app/src/components/Loading/Loading.js) · [`LoadingScreen`](../../../../app/src/components/Loading/LoadingScreen.js) · [`DotsLoader`](../../../../app/src/components/Loading/DotsLoader.js) | Blocking modal · full screen · inline pulse |
| [`DateRangePicker`](../../../../app/src/components/DateRangePicker/index.js) | Calendar range selection |

**The module kit** — [src/components/pattern/](../../../../app/src/components/pattern/)

| Component | Use for |
| --- | --- |
| `DataList` + `DataListRow` | The card list that replaces a web `<Table>` |
| `StatCard` | Label + dim icon + value + caption |
| `FilterBar` | Search, refresh and filter toggle inside the list card |
| `ListFooter` | Count + prev/next pager |
| `EmptyState` | No-records state, with a different message when filters are on |
| `FormSheet` | Full-screen create/edit surface |
| `Fab` + `FAB_CLEARANCE` | Floating create action, and the padding the list needs to clear it |
| `SectionLabel` · `StatusToggle` · `StatusDot` · `InitialAvatar` | Form and row primitives |

No screen uses the module kit today (the session device has no admin
lists); the conventions for when one does are in
[module-pattern.md](module-pattern.md).

**Dyna Cam building blocks** — [src/components/](../../../../app/src/components/)

| Component | Use for |
| --- | --- |
| `QrCode` | A QR of any string, black on white in both themes (`toqr` + react-native-svg) |
| `TickingTimer` | A "12:34" timer counting up (REC) or down (unpair countdown) from an API "…Seconds" value + the query's `dataUpdatedAt`; owns its clock so only it re-renders |
| `ConnectionBanner` | "Can't reach Dyna Cam — retrying" for a connection error (no response / 5xx); nothing otherwise |
| `QueryState` | Loading / error-with-retry for a single-record screen |

Helpers: `utils/dynaCam.js` (Manila `formatTime`, `formatElapsed`,
`secondsSince`, `shortLink`, `isConnectionError`, live-link `liveIdentity` /
`liveExpiryMs`), `hooks/useNow.js`.

**RNR primitives** — [src/components/ui/](../../../../app/src/components/ui/) holds `Button`,
`Text`, `Input`, `Switch`, `Card`, `Separator`, `Label`, `Dialog`,
`DropdownMenu`, `Avatar`, `Badge`. These are **copied into the repo, not
installed**, so edit them freely. Add more with:

```bash
npx @react-native-reusables/cli@latest add <name> --yes --styling-library nativewind
```

Every component takes a `className` and merges it through
[`cn()`](../../../../app/src/lib/utils.js), so callers can always override styling. Colours come
from Tailwind classes, never props.
