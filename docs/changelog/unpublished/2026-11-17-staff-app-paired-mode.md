---
type: added
impact: minor
audience: user
ref: PLAN-002
---

The staff app can now be **paired** to a venue instead of signed in. Open the app, type the
6-digit key from **Dyna Cam → Paired Apps → Pair a phone**, and the phone stays paired until it is
unpaired or revoked. A paired phone shows the venue's courts: pick one, tap **Record** to save the
last 60 seconds, and a big QR code appears for the player to photograph or scan. From a court you
can show a recent clip's QR again, and **Take payment** records cash for a clip. If the Wi-Fi
drops, the phone keeps its pairing and retries. Managers can still sign in with their staff
account.

## Dev notes

- `app/`: **new dev build required** — adds the native `expo-secure-store` (holds the paired token
  under the key `paired-app`; an old build crashes on launch without it). `expo-keep-awake` is now
  listed explicitly (already part of `expo`). The first screen for a phone that's neither paired
  nor signed in is now **Pair this phone** (Login is one tap away).
- `back/`: new `POST /api/v1/app/unpair` (a phone revokes itself); `/app/clips` responses add
  `failureReason`.
