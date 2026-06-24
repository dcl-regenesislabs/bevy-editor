# Editor web UI

React UI for the editor scene, rendered in the **host page** (bevy-explorer's
web shell) instead of SDK7 scene UI. It reuses the scene's logic modules
(`../src`: state, inspector, schema, composite, custom components, import,
save-diff) and talks to the engine the same way the scene does — console
commands — via the `window.engine_console_command_args` binding exposed by
bevy-web.

## Architecture

```
┌────────────────────────── browser page ──────────────────────────┐
│  React UI (this app)                bevy engine (wasm)           │
│  hierarchy / inspector / toolbar     ┌──────────────────────┐    │
│  dialogs (import, save diff, …)  ──► │ console commands     │    │
│        │                             │ (/crdt_snapshot,     │    │
│        │ BroadcastChannel            │  /set_component, …)  │    │
│        ▼                             └──────────┬───────────┘    │
│  message bus (page ↔ scene)                     │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  ▼
                                   editor scene (system scene)
                                   gizmos · markers · relations
                                   selection raycast · free-cam · login
```

- The page drives **everything inspector-shaped** directly against the engine.
- The scene keeps **viewport work**: gizmo handles, world markers, relation
  links, click/box selection, camera modes, and login (system-api access).

## UX model

- **The scene starts paused** when the editor attaches (`freeze_scene`), so
  scene systems stop ticking while you edit. Play / step / pause live in the
  toolbar; pressing Play sticks for the session.
- **The hierarchy shows only authored entities** (those with a
  `core-schema::Name`) while paused — runtime entities appear when the scene
  runs, or via "Showing all entities" in the ⋯ menu.
- **No JSON editing by default**: properties render as typed fields —
  Transform with Euler degrees and scrubbable X/Y/Z labels, enums as
  dropdowns, bools as toggles, colors as swatches, oneofs as mode selects,
  nested messages as groups. Every commit (enter/blur/toggle) auto-applies.
  Raw JSON remains available per component behind the "json" toggle.
- Rename inline in the inspector header; panels collapse to edge buttons
  (state persists in localStorage); transient results surface as a toast.
- Styling follows the shared regenesis design tokens (HSL custom properties,
  one accent, Inter, thin scrollbars) in `src/styles.ts`.
- The two sync over a same-origin **`BroadcastChannel`**
  (`../scene/src/editor-channel.ts`): selection, tool, flags, camera, gizmo drag
  notifications, and rpc for system-api calls. No engine bus is involved — the
  channel rides upstream-only same-origin browser APIs. Protocol types:
  `../src/bridge-protocol.ts`. Scene-side client: `../src/page-ui.ts`.
  Page-side client: `src/bus.ts`.
- When the page UI announces itself (`init`), the scene sets `state.pageUi`
  and stops rendering its SDK7 panels (gizmo/marker/relation layers stay).

## Build

```bash
npm install
npm run build    # bundles editor-ui.js into the bevy web dir
npm run watch    # rebuild on change
```

The bevy web dir is the stock-upstream engine build — the
`@dcl-regenesislabs/bevy-explorer-web` npm package by default, or a local engine
build via `BEVY_WEB_DIR`. There is no engine fork: the editor adds only this
bundle alongside the unmodified engine.

`build.mjs` stubs `~system/*` imports and swaps `bevy-api`/`utils`/`login`/
`current-scene` for browser implementations (`src/*-web.ts`); everything else
from `../src` bundles as-is (`@dcl/ecs` runs fine in the browser for schema
encode/decode).

## Run

Serve the bevy web dir (the `@dcl-regenesislabs/bevy-explorer-web` package dir,
or a local build via `BEVY_WEB_DIR`; needs COOP/COEP headers, `npx serve` honors
the bundled `serve.json`), then open with the `editorUi` query param:

```
http://localhost:3000/?position=2,3&systemScene=http://localhost:8005&realm=http://localhost:8004&editorUi=true
```

The first run on a fresh machine recompiles the whole GPU pipeline cache and
can stall for several minutes; later loads reuse the IndexedDB cache.
