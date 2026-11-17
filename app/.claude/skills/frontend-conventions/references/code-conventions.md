# Code Conventions

General coding standards for this app. Follow these everywhere under `src/`
and in `App.js`.

---

## Language & framework

- React 19, function components and hooks only — no classes
- JavaScript (`.js`; RNR primitives are `.jsx`) — no TypeScript. `tsconfig.json`
  exists for the `@/` alias and loose checking (`strict: false`); the code is
  not written to satisfy `tsc`
- ES modules — `import` / `export`, never `require` in app code
- Expo SDK 58 / React Native 0.88, New Architecture, Hermes

---

## File & folder naming

| Item | Convention | Example |
| --- | --- | --- |
| Screen folder | PascalCase, entry file `index.js` | `Screens/Example/index.js` |
| Module state hook | `use<Folder>Module.js`, next to the screen | `Screens/Example/useExampleModule.js` |
| Module sheet | `<Entity>FormSheet.js`, next to the screen | `Screens/Example/ExampleFormSheet.js` |
| Hand-written component | PascalCase `.js` | `components/ScreenHeader.js` |
| RNR primitive | kebab-case `.jsx`, CLI-generated | `components/ui/dropdown-menu.jsx` |
| Hook | `useX.js` | `hooks/useAppFonts.js` |
| Zustand store | `useXStore.js` | `store/useThemeStore.js` |
| API / requests file | lowercase domain, same name in both folders | `services/api/auth.js` ↔ `services/requests/auth.js` |
| SQLite table / endpoints | `<table>.table.js` / `<table>.endpoints.js` | `example.table.js`, `example.endpoints.js` |
| Migration | `NNN_<what>.js` | `001_add_item_note.js` |
| Util | camelCase `.js` | `utils/dateFormat.js` |

`Screens/Login/Index.js` has a capital `I` for historical reasons. New screens
use `index.js`.

---

## Exports

| What | Style | Example |
| --- | --- | --- |
| Screen | `export default` | `export default ExampleScreen;` |
| Component | `export default` | `export default ScreenHeader;` |
| Hook | named, plus default if it is the file's only export | `export const useExampleModule = …; export default useExampleModule;` |
| API function | named, `…Api` suffix | `export const loginApi = async (payload) => …` |
| Request hook | named, `use…` | `export const useLoginAuth = () => …` |
| SQLite endpoint | named, `db_` prefix | `export const db_getItems = () => …` |

Hand-written components are arrow functions with a default export:

```js
const ScreenHeader = ({ title, onBack, className }) => {
  return <View className={cn("…", className)}>…</View>;
};

export default ScreenHeader;
```

Files under `components/ui/` keep whatever the RNR CLI generated (`function
Button(…)`). Don't restyle them; it makes the next `add` harder to diff.

---

## Imports

- `@/` resolves to `src/` through `tsconfig.json` `paths`, handled by Expo's
  Metro. There is no babel module-resolver.
- **RNR files import via `@/components/ui/*` and `@/lib/utils`.** Never rewrite
  those to relative paths.
- App code may use either. Prefer `@/` across the tree (`@/hooks/useTheme`) and
  relative paths for neighbours (`./ExampleFormSheet`).
- The module kit is imported through its index:
  `import { DataList, Fab, FAB_CLEARANCE } from "@/components/pattern";`.

Group imports: React and third-party first, then `@/` imports, then relative —
the order the existing screens already use.

---

## The library set

Use what is installed. Adding a library is a decision, not a convenience — see
[ENGINEERING_CHECKLIST §8](../../../../docs/ENGINEERING_CHECKLIST.md).

| Purpose | Use | Not |
| --- | --- | --- |
| UI primitives | React Native Reusables in `components/ui/` (add with the CLI) | another component kit |
| Styling | NativeWind classes + `cn()` from `@/lib/utils` | `StyleSheet` for colour, inline hex |
| Icons | `lucide-react-native`, passed as components (`icon: Package`) | emoji, icon fonts |
| Global state | Zustand (`store/`), persisted through AsyncStorage | Context for state, Redux |
| Server state | TanStack React Query via `services/requests/` | `useEffect` + `useState` fetching |
| HTTP | axios instances from `services/api/axios.js` | `fetch`, a fresh `axios.create` per file |
| Local data | `expo-sqlite` through `store/database/db.js` | AsyncStorage for records |
| Toasts | `Toast.show` from `react-native-toast-message`, in `requests/` | `alert()` |
| Confirm a destructive action | `Alert.alert` with a `destructive` button, or `useCustomDialog()` for the styled dialog | deleting without asking |
| Dates | `utils/dateFormat.js` (platform `Intl`, no library) | `moment`, `dayjs` |
| Images | `expo-image` with explicit dimensions | RN `Image` for remote images |
| Forms | `useState` draft + dirty check in the sheet (see `ExampleFormSheet.js`) | a form library without a decision |
| Navigation | React Navigation native stack + `SCREEN_NAVIGATION` | Expo Router |
| Animation | RN `Animated` with `useNativeDriver: true` (`AnimatedField`), Reanimated where RNR uses it | `transition-*` classes on native |

Install with `npx expo install <pkg>` so the SDK-pinned version is chosen. If
the package has native code, say so: it needs `npx expo prebuild --clean` and
a new dev build, and it won't run in Expo Go.

---

## Where state lives

1. **Server data** → React Query, through a hook in `services/requests/`.
   Never copied into Zustand.
2. **Session and app-wide preferences** → Zustand (`useUserAuthStore`,
   `useThemeStore`). Read with a narrow selector.
3. **A screen's UI state** (search, filters, page, which record is open) → the
   module's `use<Folder>Module.js` hook. The screen file stays layout-only.
4. **A form's draft** → `useState` inside the sheet, reset when a different
   record opens.
5. **Local records** → SQLite, through `db_*` endpoints.

---

## Error handling

- **`api/` files have no try/catch.** Errors propagate to React Query.
- **Mutations** report failure in `onError`:
  `Toast.show({ type: "error", text1: "…failed", text2: error.response?.data?.message || "Something went wrong" })`.
- **Queries** surface failure on the screen — an error state with a retry, not
  only a toast. Partial failure must not blank the whole screen.
- **Caught errors** in handlers log with `console.error`. No leftover
  `console.log` debugging; the `[DB]` lines in `initDatabase.js` are the
  deliberate exception.

---

## React Native rendering traps

```jsx
// ❌ count === 0 renders a bare "0" outside <Text> — throws on native
{count && <Badge>{count}</Badge>}

// ✅ the repo's idiom
{count > 0 ? <Badge>{count}</Badge> : null}
```

- Every string sits inside RNR's `<Text>` (`@/components/ui/text`), not React
  Native's, so colour and size inherit through `TextClassContext`.
- `numberOfLines` on any text that can grow, so long values truncate instead
  of breaking a row.
- Icon-only `Pressable`s get `accessibilityLabel` and `accessibilityRole`, and
  `hitSlop` if they're under 44px.

---

## Comments

Doc comments carry more weight here than usual: this is a template, and the
comments are how the next developer learns it. Match the density of the file
you're in — a block comment explaining *why* above anything non-obvious — and
don't trim existing ones.
