# CR-040 · Videos stay at the venue and go straight to Google Drive; the cloud keeps only data

> **Status:** In progress · **Requested:** 2026-11-24 · **Requested by:** bryanken00 (for his boss) · **Size:** XL
> **Checklist:** [checklist.md](checklist.md) · **Plan:** [PLAN-005](../../plans/PLAN-005-videos-local-drive-only/plan.md) · **Related:** [CR-001](../CR-001-google-drive-per-court/request.md) (Drive per court), [CR-006](../CR-006-one-file-per-game/request.md) (one file per game), [CR-013](../CR-013-save-last-minutes/request.md) (saves), [CR-017](../CR-017-auto-delete-24h/request.md) / [CR-026](../CR-026-keep-7-days-drive-2-days/request.md) (keep times), [CR-018](../CR-018-email-drive-link/request.md) (Drive-link email), [cloud deployment runbook](../../cloud-deployment-runbook.md)

## Requested change

> My boss wants this booking online / cloud, but the recording is only local.
> The videos must save on the local server, not on the cloud. Cloud is database only.
> The local and cloud must sync from time to time.
> The local server must upload it to Google Drive — that's where they can access the video.
> No internal link.

Booking, payments, the Admin and every page run in the cloud, but **no video file is ever stored
on or sent through the cloud**. Each venue's recorder box keeps its games' videos and uploads them
**straight to the court's Google Drive**. Players get their game only as a **Google Drive link**;
nothing on the website plays or downloads a video from our servers or from the box. The cloud
holds the records — which game, which court, where it is on Drive, how far its upload is — and
the box and the cloud keep each other up to date.

## Today

- The box records the game, makes one file per camera, and **uploads it to the API server**,
  which keeps it for 7 days and **deletes the box's copy** once it has it.
- The player's game page, the court's device (app) and the Admin **play and download the video
  from the API server**.
- If the court has a Google account connected, the **API server** copies each video to that
  Drive afterwards, and moves it to Drive's trash 2 days later.
- Saves ("Save the last …") go the same way.

## Why

The cloud server should hold data only: video files are large, cost storage and bandwidth, and
the venue already has them. Google Drive gives players a link that works anywhere, without our
servers serving video.

## Scope

**In**

- The box keeps each game's videos (and saves) on its own disk for the venue's keep time.
- The box uploads them to the court's Google Drive itself; the Drive sign-in stays in the cloud
  (the cloud opens each upload, the box sends the file to Google).
- The player's game page, the court's device and the Admin show **Google Drive links only** — no
  video player or download from our server.
- The box tells the cloud each video's state (kept on the box, uploading to Drive and how far,
  on Drive, removed) whenever it checks in, and keeps working through internet outages.
- The Drive-link email keeps working.
- The API stops accepting and storing video files once every box has the update.

**Out**

- Live view during a game (it already comes straight from the box over the venue Wi-Fi and is
  not a stored video) — kept as is unless decided otherwise (open question).
- Booking, payments, the TV board — unchanged.
- The mobile app's look beyond swapping its video player for the Drive link.

## Acceptance criteria

- A finished game's videos never appear on the cloud server's disk; they're on the venue box and
  in the court's Google Drive.
- The player's game page shows "Open in Google Drive" for the whole game and each save, and no
  video plays from our site.
- While the box is still uploading, the game page shows how far it is; when it's on Drive, the
  link appears (and the email goes out).
- With the venue's internet cut for a while, the box keeps the videos and uploads them when it's
  back.
- A court without Google Drive connected says so to staff (videos stay on the box only).

## Impact

| Area | Detail |
| --- | --- |
| Screens | Player game page, Admin Sessions (detail, Footage, Drive dialog), court's device app (end and saves screens), court setup (Drive required) |
| Data | **Migration**: new `session_videos` columns for the box's copy and the Drive upload (state, progress, upload session); file-path columns stop being used |
| Build / rollout | **Recorder box update at every venue** (new upload path, local keep time, bigger SSD: ~0.5 GB per camera-hour × keep days). **New app build** (video player removed). The API keeps the old upload path until every box reports the new one. |
| Permissions | none |
| Existing users | **Breaking:** players can no longer watch or download on our site — only via Google Drive; a court without Drive gives players no video. Existing videos on the server age out (7 days). |
| Size | XL — box, API, website and app; split into phases in PLAN-005 |

## Open questions

Decided 2026-11-24 (bryanken00: "go with your proposals"):

- [x] The box and Drive both keep a video for the venue's keep time (7 days); Drive no longer
      trashes after 2.
- [x] A court without Google Drive: no video for players; court setup warns. Check-in isn't blocked.
- [x] Saves: each its own Drive file and link.
- [x] Live view and save previews on the venue Wi-Fi: kept.
- [x] Videos already on the cloud server at switch-over: they age out (7 days).
- [x] Staff can't download a video from a court without Drive either (no internal link): it stays
      on the box for the keep time, and Retry sends it once Drive is connected.

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-24 | "go with your proposals" — see Open questions |
