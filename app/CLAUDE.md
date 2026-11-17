# Mobile app — (Expo React Native session device)

## ⚠️ Before writing any code in `app/`, load the `mobile-conventions` skill

The conventions are **non-negotiable** and live in that skill
([`.claude/skills/mobile-conventions/`](../.claude/skills/mobile-conventions/SKILL.md)) — seven
topic docs covering the architecture and traps, the engineering checklist, the project structure and component kit, code style, the data
layer, the design guidelines, and the list-module pattern. The skill's table says which one to
read for the area you're touching. Read `architecture-and-traps.md` first: the theming, font-weight
and Reanimated traps there are easy to walk into.

The app is a **session device** (PLAN-002 §5): Pair this device → Session (live video, QR, Stop)
→ Ended → Pair. There is no sign-in and no staff-account app. A new admin-style list module would
use the **`new-mobile-module`** skill — read its status note first, since it needs the removed
staff sign-in back. If it needs a new table or endpoint, the API and web half comes from
**`new-module`** first.

## Stack

Expo SDK 58 · React Native 0.88 · React 19 · JavaScript (no TypeScript) · React Native Reusables
on NativeWind (Tailwind v3) · lucide-react-native · Zustand · TanStack React Query 5 · axios ·
expo-sqlite · React Navigation 7.

## Commands (run in `app/`)

```bash
npm start                                   # expo start --clear
npx expo-doctor@latest                      # verification, 1 of 2
npx expo export --platform android --clear  # verification, 2 of 2: does it bundle?
```

There is no test runner, linter or formatter; don't invent `npm test`. The API URL comes from
`EXPO_PUBLIC_API_URL` in `app/.env` (copy `.env.example`); on a physical device use your
machine's LAN IP and port `4021`.

Plans, change requests, bug reports and the changelog are shared with the whole repo and live in
the repo-root [`docs/`](../docs/README.md).
