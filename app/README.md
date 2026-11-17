# Dyna Cam — session device

The Expo / React Native app on the phone or tablet at the court. Staff book a session on the web
(Sessions → Book session) and tap **Pair a device**, which shows a 6-digit key. Typed into this
app, the key pairs the device to **that one session**:

1. **Pair this device** — enter the key.
2. **Session** — the court's live video (from the venue's recorder box, over the venue Wi-Fi),
   the session's download QR, a REC timer and **Stop recording**. A secondary **Stream to your
   Facebook / YouTube** button shows a QR the player scans with their own phone to paste their
   stream key; the stream's state then shows under the header, with Change / Stop streaming.
3. **Ended** — the QR full screen with the saving progress, **Done**, and "This device unpairs in
   9:41". After Done or 10 minutes the device unpairs itself and is back at step 1.

There is **no sign-in**: staff work (booking, clips, payments at the counter) happens on the web.
See [PLAN-002](../docs/plans/PLAN-002-setup-menu-device-pairing/plan.md) §5.

**Stack:** Expo SDK 58 · React Native 0.88 · React 19.3 · React Navigation 7 ·
[React Native Reusables](https://reactnativereusables.com) + NativeWind
(Tailwind) · TanStack Query 5 · Zustand 5 · Axios · expo-secure-store · expo-video ·
expo-keep-awake · lucide icons · Onest + JetBrains Mono

Conventions, architecture, the component kit and the traps live in the
[`mobile-conventions`](../.claude/skills/mobile-conventions/SKILL.md) skill. Plans, bug reports,
change requests and the changelog live in the repo-root [`docs/`](../docs/README.md).

---

## Quick start

Start the API first (`cd back && npm run dev`, port `4021`), then:

```bash
cd app
npm install
cp .env.example .env          # then set EXPO_PUBLIC_API_URL
npx expo start
```

On a physical device, `localhost` is the device itself — set `EXPO_PUBLIC_API_URL` to your
computer's LAN IP, e.g. `http://192.168.1.20:4021`. The first screen is **Pair this device**:
book a session in the Admin portal, open it, tap **Pair a device**, and type the key shown. The
live video only plays when the device is on the same network as the venue's recorder box.

Press `a` for Android, `i` for iOS, or scan the QR code with Expo Go.

Some dependencies need native code, so **Expo Go will not run everything**. The app needs a
dev build that includes `expo-secure-store` (the pairing token), `expo-video` (live view) and
the `app.json` native settings below — a build made before PLAN-002 Phase E **must be rebuilt**:

- **Android:** plain-HTTP traffic is allowed (`expo-build-properties` →
  `usesCleartextTraffic`), because the recorder box serves the live video over `http://` on
  the LAN.
- **iOS:** `NSAllowsLocalNetworking` and a Local Network usage text ("Dyna Cam shows the
  court's live video from the venue's recorder box"); iOS asks the user once.
- **Orientation:** any (`"orientation": "default"`, `ios.supportsTablet`), so a tablet can sit
  in landscape with the video and QR side by side.

For a full build:

```bash
npx expo prebuild          # generates android/ and ios/ (both gitignored)
npx expo run:android       # or run:ios
```

## Verify a change

There is no test runner or linter. Before reporting a change done:

```bash
npx expo-doctor@latest                      # 20/20 expected
npx expo export --platform android --clear  # does it bundle?
```

---

## Demo mode

Set `EXPO_PUBLIC_DEMO_MODE=true` in `.env` and the app stops talking to
the network entirely; the Pair screen shows an amber **Demo mode** badge so a
demo can never be mistaken for a real session. Useful for UI work without the
API running.

| | Demo on | Demo off |
| --- | --- | --- |
| `usePairDevice` | any 6-digit key pairs (`000000` is "wrong") | `POST /api/v1/pair/app` |
| `useGetDeviceSession` | "Court 1", recording since 3 min ago, no live video | `GET /api/v1/app/session` (every 5 s) |
| `useStopSession` | Processing, then Ready after ~8 s; the 10-min countdown starts | `POST /api/v1/app/session/stop` |
| `useCreateStreamLink` | a demo link; ~6 s later the session reports a Facebook stream "starting", "live" 5 s after | `POST /api/v1/app/session/stream-link` |
| `useStopStream` | clears the stream | `POST /api/v1/app/session/stream/stop` |
| Done | forgets the token | `POST /api/v1/app/unpair`, then forgets it |

The switch is an `IS_DEMO` check inside each hook in
[src/services/requests/](src/services/requests/); fixtures live
in [src/constants/demo.js](src/constants/demo.js).

> `EXPO_PUBLIC_DEMO_MODE` must be exactly `"true"` — env vars arrive as
> strings, so anything else (including `1`) leaves demo mode off.

---

## Environment variables

| Variable | What |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | Base URL of the API (`back/`), e.g. `http://192.168.1.20:4021` |
| `EXPO_PUBLIC_DEMO_MODE` | `"true"` to pair to a demo session with no API (dev only) |

Only `EXPO_PUBLIC_*` variables reach the app, and they are **inlined into the
bundle at build time** — readable by anyone who unpacks the APK. API hosts and
feature flags are fine; secrets are not. Restart with `npx expo start --clear`
after editing `.env`.

⚠️ Because it is inlined, **a build made with `EXPO_PUBLIC_DEMO_MODE=true`
ships permanently in demo mode.** The `production` profile in
[eas.json](eas.json) forces it off.

---

## Builds and releases

- **EAS:** `eas.json` has `development`, `preview` (APK) and `production` profiles. Run
  `eas init` once to create the project ID; the repo ships no `projectId` or `owner`.
- **Version:** the app shares the product version with `front/` and `back/`. Never bump it by
  hand — `/publish` updates `package.json`, `app.json` and `src/constants/version.js` together.
  EAS owns `versionCode` / `buildNumber`.
- **`android/` and `ios/` are gitignored.** They are generated by `expo prebuild`. Committing
  them silently overrides `app.json`.

## Notes

- **Token storage.** The device's pairing token is kept in `expo-secure-store`
  (Keychain / Android Keystore) by [usePairedStore.js](src/store/usePairedStore.js) — never
  AsyncStorage. Never log it, an axios error (its headers hold it), or a live-video link (its
  `sig` is a signature).
- **Upgrading the SDK later.** `npx expo install expo@^59.0.0 --fix`, then
  `npx expo-doctor@latest`, then delete `android/`+`ios/` and re-run
  `npx expo prebuild`. NativeWind is the piece most likely to lag a new SDK —
  `npx expo export` is the fastest way to confirm it still compiles.
