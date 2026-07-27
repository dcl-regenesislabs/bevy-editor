# Releasing

Maintainer guide: desktop images, CI builds, releases, auto-update, and signing.
For the app-size budget that gates every PR's image, see
[CONTRIBUTING → App size](../CONTRIBUTING.md#app-size-every-pr-carries-its-own-numbers).

---

## Desktop images

`npm run dist` packages the app with electron-builder
(`packages/desktop/electron-builder.yml`) into `packages/desktop/release/`
(macOS `.dmg` / Windows NSIS installer `.exe`).

The image is **self-contained** — end users need nothing preinstalled:

- the engine wasm,
- the UI bundle,
- the scene templates,
- the editor system scene (with `@dcl-editor/contract` vendored in),
- **a Node.js runtime + npm** (`resources/node`, added by
  `packages/desktop/scripts/bundle-node.cjs`, wired as electron-builder's
  `afterPack` hook).

On first launch the editor scene is copied to a writable per-version folder
under `userData` and installs its deps there.

`npm run size` measures the packaged image (installer, installed,
per-component breakdown); `npm run size:check` compares against the committed
`app-size.json` — the check CI enforces on every PR (see the CONTRIBUTING link
above).

---

## CI builds

### `desktop-images.yml` — every PR and every push to `main`

Builds a macOS `.dmg` and a Windows `.exe`, uploads them as workflow
artifacts, and runs the app-size gate.

| Trigger | Signing | mac arches |
|---|---|---|
| every PR | always **unsigned** — PR builds see no signing secrets at all (fork PRs can't see secrets anyway, and unsigned is faster for review artifacts) | arm64 only |
| every push to `main` | signed when the cert secrets exist; mac notarized when **all three** `APPLE_*` secrets exist too | arm64 + x64 |

The mac dmgs upload as **separate per-arch artifacts**
(`bevy-editor-macos-arm64` / `bevy-editor-macos-x64`) so a download is one
architecture, not both (the x64 artifact exists on `main` builds only, since
PRs build arm64 only). Windows uploads as `bevy-editor-windows`. On PRs a
sticky per-platform comment links the artifact download.

These builds are the place to **smoke-test before releasing** — see the rules
below.

### `release.yml` — creating a release in the GitHub UI

Runs on `v*` tag push, which in this repo only ever happens by publishing a
release in the GitHub UI (see the rules below). It:

1. **Guards the tag**: must be `vMAJOR.MINOR.PATCH` — the tag becomes the app
   version verbatim and the in-app updater compares it numerically, so
   anything else refuses to build.
2. **Builds signed images** (same secrets as `desktop-images.yml`; missing
   secrets degrade to unsigned) with the app version **stamped from the tag**
   (`-c.extraMetadata.version`) — `app.getVersion()`, the artifact names and
   `latest*.yml` all pick it up, so releasing needs **no version-bump commit**
   (the version in `packages/desktop/package.json` only matters for local dev
   builds).
3. **Publishes from one job**: both platform builds upload artifacts, then a
   single publish job attaches everything to the release — electron-builder's
   own `--publish` races when two matrix jobs touch the same release.
4. **Appends the macOS install note** to the release notes (see below).

---

## Auto-update

Installed apps check the newest **published** GitHub Release in the background
(**30 s after launch, then every 4 h**), download + stage the update
**silently**, and show a passive **"Restart to update"** affordance (Home
rail, gear menu, Account section). An ignored update installs on the next
normal quit.

- **Windows** uses electron-updater's stock NSIS flow.
- **macOS** uses a custom step in `packages/desktop/src/updater.ts`: download
  the release zip, verify it against `latest-mac.yml`'s **sha512**, and swap
  the `.app` in place — because **Squirrel.Mac refuses unsigned apps**. If
  builds are ever signed, that branch can be deleted in favour of stock
  electron-updater on both platforms.

---

## Release process rules

The updater depends on these — breaking them silently bricks updates for
installed apps:

- **Releasing is one action, in the GitHub UI only**: Releases → Draft a new
  release → new tag `vX.Y.Z` on `main` → Publish. That's it — publishing
  creates the tag, `release.yml` builds the images (version stamped from the
  tag, no version-bump commit) and attaches them. A **bare CLI tag is
  refused**: the publish job errors out if no release with that name exists.
- Every installed app picks the release up **within hours**, so only release
  a commit whose images you'd ship — the PR/`main` builds from
  `desktop-images.yml` are the place to smoke-test first.
- The workflow **refuses to publish images without the update metadata files**
  (`latest-mac.yml`, `latest.yml`, and both mac update zips) — a release
  missing them would brick every installed client's update check the moment
  it's published.
- **Never delete `latest*.yml`, `.zip` or `.blockmap` assets** from a
  published release.
- **Never split the release mac build per-arch**: one job must run
  `--mac --arm64 --x64` and emit **one `latest-mac.yml`** listing both arches'
  zips — electron-updater picks by `process.arch`. Splitting per-arch (as
  `desktop-images.yml` does for its review artifacts) makes two
  `latest-mac.yml` uploads clobber each other and silently breaks updates for
  one arch. See the comment in `release.yml`.

---

## Signing secrets

Signing is driven entirely by repo secrets — **all optional**. Missing or
partial secrets degrade to unsigned/unnotarized builds; they never fail the
workflow. (Notarization additionally requires the mac cert to be present.)

| Secret | What it is |
|---|---|
| `MAC_CERTS` / `MAC_CERTS_PASSWORD` | Base64 of the Developer ID Application `.p12` + its password. |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Notarization credentials (app-specific password from appleid.apple.com). |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Base64 of the Windows code-signing `.pfx` + its password. |

---

## macOS quarantine (unsigned builds)

macOS shows **"Bevy Scene Editor is damaged and can't be opened"** for any
unsigned app downloaded from a browser — the app isn't damaged, it just isn't
signed with an Apple certificate. The user-side fix, once, after dragging the
app to Applications:

```bash
xattr -d com.apple.quarantine "/Applications/Bevy Scene Editor.app"
```

First install only — auto-updates download without the quarantine flag, so
the dialog never appears again. `release.yml` **appends this same note to
every GitHub release automatically** (idempotent via an HTML-comment marker;
hand-written notes stay on top).

The real fix is Developer ID signing + notarization (the secrets above) —
signed images open clean, and both this note and the `release.yml` step that
appends it become obsolete.
