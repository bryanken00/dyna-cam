# Mobile app: project structure and component kit

Where things live in `app/src/` and which shared components to reach for before writing a new
one. Paths are relative to `app/`. (Moved here from `app/README.md`.)

## Folder layout (`app/src/`)

```
src/
├─ Navigation/        Stack navigator, auth-gated
├─ Screens/
│  ├─ Login/          Reference implementation for the design guidelines
│  ├─ Example/        Reference module — copy this to start a new one
│  └─ Home/           Bottom-tab shell
│     ├─ Dashboard/   Placeholder — replaced by the first real screen (PLAN-001 Phase 6)
│     └─ Settings/    Modules list + dark-mode toggle + sign out
├─ components/        Shared UI — see the component kit below
│  ├─ ui/             React Native Reusables primitives (copied in, yours to edit)
│  └─ pattern/        The list-module kit
├─ constants/         navigation names, env-derived config, demo fixtures, version
├─ hooks/             useTheme, useAppFonts, useCustomDialog, useCamera
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

[src/Screens/Example/](../../../../app/src/Screens/Example/) composes all of them into a working
module; the conventions are in [module-pattern.md](module-pattern.md).

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
