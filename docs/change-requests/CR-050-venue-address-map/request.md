# CR-050 · Venue address from the PH address list, with a map pin

> **Status:** In progress · **Requested:** 2026-11-26 · **Requested by:** bryanken00 · **Size:** M
> **Checklist:** [checklist.md](checklist.md) · **Plan:** — · **Related:** [PLAN-001](../../plans/PLAN-001-court-replay-cameras/plan.md) (venues), [PLAN-003](../../plans/PLAN-003-court-booking/plan.md) (booking pages, emails)

## Requested change

> Can we use this? front/src/assets/address — Add Google Map pin, no API key — add long lat — Revise
> address: Region, Province, City, Brgy, Street (optional) — then pin location

When staff create or edit a venue:

1. They pick the address from the official Philippine list: **Region → Province → City /
   Municipality → Barangay**, each list narrowed by the one before, then type the **Street**
   (optional).
2. They **pin the venue on a map**: the map moves to the chosen city, and they click or drag the pin
   to the exact spot. Its **latitude and longitude** are saved, with an **Open in Google Maps** link
   to double-check it.

Players get a **Get directions** link (Google Maps, no key) wherever the venue's address shows.

Decided with the requester (2026-11-26):

- **The map is OpenStreetMap** (free, no key) — Google doesn't allow a draggable pin without a paid
  API key. Google is used only for the "Open in Google Maps" / "Get directions" links, which need
  no key.
- **Get directions** shows on the player's booking page, the `/book` venue list and the booking
  confirmation email.

## Today

The venue form has one free-text **Address** box. There's no map and no coordinates, so players only
see the typed address.

## Why

Typed addresses vary and can be wrong. Picking from the official list keeps them consistent, and a
pin gets players to the right gate with one tap.

## Scope

**In**

- Venue form (create and edit): Region, Province, City / Municipality, Barangay (required once a
  region is picked), Street (optional); the full address is built from them
  ("Street, Barangay, City, Province").
- A map under the address: OpenStreetMap, centred on the chosen city (or barangay) once picked;
  click or drag to place the pin; latitude / longitude shown and editable; **Clear pin**;
  **Open in Google Maps**.
- Saved: the region / province / city / barangay codes, the street, the latitude and longitude, and
  the built address text (which every page already shows).
- **Get directions** (Google Maps) for players: booking page, `/book` list, booking confirmation
  email — only when the venue has a pin.
- **Near me** on the `/book` list (added 2026-11-26): the player taps it, allows their browser's
  location, and the venues are sorted nearest first with "2.4 km away" on each. Their location is
  used in the browser only — never sent to the server. It needs an https page (or localhost).
- Existing venues keep their typed address until someone edits them; the form shows it as the
  current address.

**Out**

- A map anywhere else (Admin venue page, TV board).
- Venues outside the Philippines.
- Searching an address by typing (the lists are the search).

## Acceptance criteria

- The venue form has Region, Province, City / Municipality, Barangay and Street (optional); each
  list only shows entries inside the one above it.
- Picking a city moves the map there; clicking or dragging sets the pin and fills latitude and
  longitude; Open in Google Maps opens that spot.
- Saving and reopening the venue shows the same choices and pin.
- An existing venue still shows its old address until it's edited.
- With a pin, the booking page, the `/book` list and the confirmation email have Get directions,
  opening Google Maps directions to the pin. Without a pin, no link.
- On `/book`, Near me asks for the location, then lists the nearest venue first with its distance;
  refusing the location shows a short message and leaves the list as it was.

## Impact

| Area | Detail |
| --- | --- |
| Screens | Admin → Venues (create / edit drawer); `/book`, `/book/:token`, `/booking/:token`; booking confirmation emails |
| Data | Migration 048: on `venues` — `regionCode`, `provinceCode`, `cityMunCode`, `barangayCode`, `street`, `latitude`, `longitude` (all NULL). `address` stays (the built text). |
| Build / rollout | Web + API only. Adds `leaflet` + `react-leaflet` to `front/` (the map). The barangay list (6.6 MB) loads only when the venue form opens. The map loads OpenStreetMap tiles, and centring on a city asks OpenStreetMap's free search (Nominatim) — no key; only the place name is sent. |
| Permissions | None (venues permission as today). |
| Existing users | No change until a venue is edited. Not breaking. |
| Size | M: a migration, the venue API fields, the form (cascading lists + map), and the directions link in three pages and an email. |

## Open questions

- [x] **Map without a key:** OpenStreetMap pin + Google Maps link (decided).
- [x] **Where players see it:** Get directions on the booking page, `/book` and the confirmation
      email (decided).

## Approval

| Decision | By | Date | Notes |
| --- | --- | --- | --- |
| Approved | bryanken00 | 2026-11-26 | asked directly; map and directions choices picked by the requester |

## Revisions

- 2026-11-26: Created and approved.
- 2026-11-26: Added Near me on `/book` (bryanken00: "possible near me? getting my current long
  lat"); not in the venue form (decided).
