# Production readiness

The honest state of the editor for a team taking it over, and the prioritized
backlog to ship it to real users. This is a **handoff roadmap**, not a claim that
everything is done.

> **Status:** the codebase is well-architected, type-safe, builds + tests clean
> from the root, and has been hardened on the points below. It is **ready to hand
> off and develop against**. It is **not yet packaged for distribution** — that's
> the largest remaining workstream and is the receiving team's call (see
> [Distribution](#1-distribution--packaging-the-big-one)).

---

## What was hardened (done)

These landed in the hardening pass and are covered by `npm run validate`:

- **Electron renderer flags pinned** — `contextIsolation`, `sandbox`,
  `nodeIntegration:false` set explicitly in `main.ts` (Electron 33 already
  defaults these; pinned as defense-in-depth so a future bump can't weaken them).
- **`/opendcl` proxy bounded** — GET/HEAD-only, 20s fetch timeout, 256 MB cap, in
  both `servers.ts` and the dev server. (The proxy target origin is pinned, so it
  was never a general-purpose open proxy.)
- **Cross-platform process/port management** — `killListener`, `killChild`, and
  the `sdk-commands` capability probe now have Windows branches (netstat/taskkill,
  no `lsof`/`grep`); `caffeinate` is guarded to macOS.
- **Scene-server crash watchdog** — unexpected exits auto-restart (bounded: 3×
  with backoff), distinguishing a crash from an intentional stop, surfaced in the
  logs. (The IndexedDB boot recovery was already one-shot guarded.)
- **Unit tests + gate** — Vitest added; the pure correctness-critical logic is
  covered and `npm run validate` now runs typecheck → tests → build.
- **Observability** — namespaced loggers (`log.ts`) replace the silent
  `.catch(() => {})` sites that hid real failures (gizmo writes, schema fetches);
  per-frame traces are behind `?editorDebug`.
- **Config centralized** — operator-tunable UI timings (RPC timeout, content-poll,
  restart/autopause retries, boot watchdog) live in `packages/ui/src/config.ts`.
- **Docs** — setup runbook, debugging guide, AI-agent + e2e guide, testing guide,
  and corrected README/MIGRATION/CONTRIBUTING.

### Audit claims that were overstated (verified against the code)

The hardening was driven by an audit; several of its "critical" findings did not
hold up and were **not** acted on as written:

- The Electron renderer was **not** an open security hole — `contextIsolation` /
  `sandbox` / `nodeIntegration:false` were already on by Electron-33 defaults and
  the preload already uses `contextBridge`.
- The `/opendcl` proxy was **not** an open proxy — its target origin is hardcoded.
- The IndexedDB recovery loop could **not** loop forever — it was already
  one-shot guarded.
- `deepEqual`'s float32 tolerance **does** apply at every nesting level (a unit
  test now locks this in), contrary to the audit's "top-level only" claim.

---

## The backlog (prioritized)

### 1. Distribution & packaging (the big one)

There is **no packaging** today — the app runs via `electron .` for development.
To ship to users a team needs:

- **`electron-builder`** (or equivalent) to produce `.dmg` / `.exe` / `.AppImage`.
- **Code signing + notarization** (macOS) / Authenticode (Windows).
- **Engine bundling strategy — the crux.** The engine wasm lives in the *external*
  `bevy-explorer/deploy/web`, resolved at runtime by a relative path
  (`config.ts`). In a packaged app that sibling doesn't exist. Options: bundle the
  engine build into the app resources (≈200 MB/platform), or fetch+cache it at
  runtime (needs versioning + integrity checks). This decision gates packaging.
- **Auto-update** (`electron-updater`) if shipping outside a store.
- A startup **validation of `BEVY_WEB_DIR`** with a clear error (today a wrong/
  missing engine path fails silently into a blank viewport).

### 2. Hardening worth doing before external users

- **CSP on the served pages.** COOP/COEP are set; a `Content-Security-Policy` is
  not. Low risk locally, worth adding before any networked deployment.
- **`openProject` path validation.** The IPC accepts an arbitrary directory; add a
  whitelist / `os.homedir()` containment check before shipping to untrusted input.
- **Preload listener disposers.** `onStackLog`/`onServersReady` add listeners
  without removing them across `openProject` calls — return disposers.
- **Persistent main-process logs.** Logs are in-memory only; write to
  `app.getPath('userData')/logs` so crash reports are diagnosable.
- **Scene-restart backoff reset.** The crash watchdog counter doesn't reset after
  a long healthy uptime — a rare crash hours apart still counts toward the cap.

### 3. Code quality / maintainability

- **No god-objects:** `state.ts` and `inspector.ts` are large; split into domain
  slices when they next need surgery.
- **A `scene` public-API barrel** (`src/api.ts`) so `ui` stops importing
  `../../scene/src/*` directly (already noted in `ARCHITECTURE.md`).
- **Grow unit coverage** beyond the pure-math core (custom-components codec,
  schema, composite builder) — see [`TESTING.md`](./TESTING.md).
- **Wrap `bump()` in a `mutate(fn)`** to retire the 500ms safety-net re-render.
- A handful of `as unknown as` casts at SDK/transport boundaries could be narrowed.

### 4. E2E robustness

- Factor the CDP boilerplate into a shared helper.
- Add steps for gizmo drag, undo/redo, and autosave.
- Reduce timing flakiness (adaptive waits over fixed timeouts).

---

## Known limitations (by design, document for users)

- **Engine is external and must be built with `--features editor`** — see
  [`SETUP.md`](./SETUP.md). Not a bug; it's the fork-positioning
  ([`UPSTREAM-ALIGNMENT.md`](../UPSTREAM-ALIGNMENT.md)).
- **Play-mode edits are runtime-only** and revert on Stop (Unity-style). Intended.
- **E2E harness is macOS/Linux + GPU only.** The app and `npm run validate` run
  anywhere Electron 33 does; Windows process management is implemented but less
  exercised.
- **Not addressed (deliberately, for an internal dev tool):** WCAG accessibility,
  HTTPS on localhost, WebSocket auto-reconnect. Revisit if/when the editor is
  exposed as a public hosted product.
