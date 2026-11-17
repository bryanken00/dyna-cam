/**
 * App-wide constants.
 *
 * API host comes from the environment so the same build config works for
 * local, staging and production. Copy `.env.example` to `.env` and set it.
 *
 * Expo inlines any variable prefixed `EXPO_PUBLIC_` at build time. That means
 * it ends up readable inside the shipped bundle — put API hosts and feature
 * flags here, never secrets.
 *
 * Changing .env requires restarting the bundler with `npx expo start --clear`.
 */
export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.254.121:4021";

/**
 * Demo mode — the app makes **no network calls at all**. Any 6-digit key
 * pairs the device to a demo session (000000 is "wrong"). See
 * `constants/demo.js`.
 *
 * Use it to build UI before a backend exists, or for a clickable demo. Turn
 * it off before shipping anything real.
 *
 * Env vars arrive as strings, so `"false"` would be truthy — compare exactly.
 */
export const IS_DEMO = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
