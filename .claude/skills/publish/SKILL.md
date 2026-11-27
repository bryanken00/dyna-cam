---
name: publish
description: Cut a release. Rolls every entry in docs/changelog/unpublished/ into one plain-language, client-facing release note at docs/changelog/published/vX.Y.Z.md, picks the next semantic version from the entries' impact (major/minor/patch), bumps the one product version in front/, back/ and edge/ package.json and in app/ (package.json, app.json, src/constants/version.js), updates the release index, and clears the queue. Only when the user runs /publish.
argument-hint: "[major|minor|patch|X.Y.Z] [--dry-run]"
disable-model-invocation: true
---

# Publish a release

Arguments: **$ARGUMENTS**

- `major` / `minor` / `patch` / `X.Y.Z` (optional): overrides the computed bump
- `--dry-run` (optional): show the version and the release note, write nothing

## Step 1: Gather

1. **Entries**: every `*.md` in `docs/changelog/unpublished/` (ignore `.gitkeep`). If there are
   none, stop and say "Nothing to publish: the unpublished queue is empty."
2. **Current version**: the product has one version, kept in six places:
   - `version` in `front/package.json`, `web-app/package.json` (PLAN-009), `back/package.json` and `edge/package.json`
   - `version` in `app/package.json`
   - `expo.version` in `app/app.json` (what the App Store and Play Store show)
   - `VERSION` in `app/src/constants/version.js` (what the mobile app displays)

   **If any of them differ, stop and ask** which one is right. Never guess.
3. **Sanity**: the current version should match the newest file in `docs/changelog/published/`.
   Warn if it doesn't. If `published/v<next>.md` already exists, stop.
4. **Parse** each entry's frontmatter. If `type` or `impact` is missing, infer it from the text
   using the tables in the `changelog` skill and list the file under "Inferred" in your report.
5. **Stragglers**: run `git status --porcelain front back app edge`. Uncommitted changes there
   may be finished work that has no entry yet. Mention them; don't block.

## Step 2: Pick the version

Take the heaviest `impact` across all entries (major > minor > patch):

| Heaviest | 1.4.2 → |
| --- | --- |
| `major` | 2.0.0 |
| `minor` | 1.5.0 |
| `patch` | 1.4.3 |

An override argument beats the computed bump. If the override is **lower** than computed (e.g.
`patch` when an entry is `major`), say which entries it contradicts and ask before continuing. An
explicit `X.Y.Z` must be greater than the current version.

## Step 3: Draft the release note

Build it from each entry's summary paragraph only. **Never copy `## Dev notes`.**

````md
# Version X.Y.Z

**Released:** <Month D, YYYY>

<One or two sentences: what this update is about, in everyday words.>

## ⚠️ Before you start

- <major releases only: what users must do or relearn>

## ✨ What's new

- …

## 💡 Improvements

- …

## 🛠️ Fixes

- …

## 🗑️ Removed

- …

## 🔒 Security

- …
````

`added` goes under What's new, `improved` under Improvements, `fixed` under Fixes, `removed` under
Removed, and `security` under Security. Drop empty sections. When one portal dominates, you may
group bullets with bold sub-labels (**For company administrators**), as in
`published/v1.0.0.md`.

**This note goes to clients. Write it that way:**

- Keep it plain, friendly, and confident, in short sentences. Say "You can now…" or name the role:
  "Admins can now…".
- **Rewrite, don't paste.** Merge entries about the same feature into one bullet, and put what
  matters most to users first.
- Leave out file, component, and library names, endpoints, table names, and IDs (`PLAN-`, `BUG-`,
  `CR-`, version-control terms). Also leave out words such as API, backend, frontend, database,
  migration, refactor, query, cache, deploy, and null. Say "the system" if you must refer to it.
- For fixes, say what works now, not what was wrong in the code.
- For security, write "We fixed a security issue affecting …" and never describe how to exploit it.
- Don't list `internal` entries individually. If there are any, end Improvements with "Behind-the-
  scenes improvements to speed and reliability." If the release is internal only, that line plus
  the overview is the whole note.
- `⚠️ Before you start` appears only in a major release, and it must cover every `major` entry.

Re-read the draft once as a non-technical client would. Rewrite any sentence they'd have to ask
about.

### Store text (only when an entry touches `app/`)

If any entry's Dev notes mention `app/`, also draft the **store text**: the app-facing part of the
release in **500 characters or fewer**, plain text, no headings or emoji, short `-` bullets. Google
Play caps release notes at 500 characters per language; the App Store allows more, but the same
text works there. Count the characters and cut until it fits.

## Step 4: Stop or confirm

- `--dry-run`: print the version (with the reason) and the draft, and write nothing. Done.
- **Major bump**: show the version and the draft, and ask to confirm before writing anything.
- Minor or patch: continue.

## Step 5: Apply

1. Write `docs/changelog/published/vX.Y.Z.md`.
2. Bump every part (this updates their lockfiles too and doesn't touch git):

   ```bash
   (cd front && npm version X.Y.Z --no-git-tag-version) && (cd back && npm version X.Y.Z --no-git-tag-version) && (cd app && npm version X.Y.Z --no-git-tag-version) && (cd edge && npm version X.Y.Z --no-git-tag-version)
   ```

   then edit `"version"` under `expo` in `app/app.json`, and `VERSION` in
   `app/src/constants/version.js`. Those six are the only places the version lives.
   `vite.config.js` injects `front/package.json`'s version as `import.meta.env.APP_VERSION` (the
   Sentry release tag), so there's no env var to update.

   **Don't touch `android.versionCode` or `ios.buildNumber`.** `app/eas.json` sets
   `appVersionSource: "remote"`, so EAS owns build numbers and auto-increments them on production
   builds.
3. In `docs/changelog/README.md`, add a row directly under the Releases table header:
   `| [vX.Y.Z](published/vX.Y.Z.md) | YYYY-MM-DD | <highlight, 12 words or fewer> |`
4. **Before deleting**, collect every Dev-notes line that a deploy needs: migrations, new env
   vars, manual steps; for `app/`, new native modules or config plugins (needs a new store build
   and a local `npx expo prebuild --clean`), new `EXPO_PUBLIC_*` variables, local SQLite
   migrations, new permission prompts, anything that signs users out; for `edge/`, a recorder-box
   update that has to be rolled out to every venue.
5. Delete the entry files you published from `unpublished/`, keeping `.gitkeep`. Their technical
   notes stay in git history.

## Step 6: Report

Run `git diff --stat`, then report:

- old → new version and why (e.g. "minor: 2 new features, 3 fixes")
- the path and full text of the release note
- the store text with its character count, if one was drafted
- **Deploy notes** from step 5.4, or "none"
- any inferred entries or stragglers from Step 1

**Don't commit or tag on your own.** Offer:

```bash
git add docs/changelog front/package*.json back/package*.json edge/package*.json app/package*.json app/app.json app/src/constants/version.js
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
```

The store build itself (`eas build`, `eas submit`) and the recorder-box rollout are the user's
call.
