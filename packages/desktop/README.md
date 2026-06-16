# bevy-editor-app

Desktop shell for the Decentraland **in-world bevy editor**. Same editor as the
browser flow — viewport gizmos, click-to-select with highlight, hierarchy of
named entities, typed inspector, model import from the asset catalog, undo/redo,
autosave to the scene's data layer — packaged for people who don't want a
terminal. Terminal users keep the exact same stack and just open the URL.

## How it works

This app contains **no editor logic**. The editor lives in two sibling projects
and is consumed over an RPC seam:

```
┌ bevy-editor-app (this repo) ────────────────────────────┐
│ electron main: project picker, spawns the local stack,  │
│ serves bevy-explorer/deploy/web with COOP/COEP          │
│   renderer = the editor page itself                     │
└───────────────┬─────────────────────────────────────────┘
                │ loads
   http://localhost:3010/?realm=…&systemScene=…&editorUi=true
                │
┌ bevy-explorer (wasm) ──────┐  ┌ editor-scene ───────────────┐
│ engine + console-command   │  │ system scene (gizmos, picking│
│ RPC: window.engine_console │←→│ selection, highlight) +      │
│ _command_args(cmd, args[]) │  │ web-ui React panels          │
│ /editor_send /editor_poll  │  │ bridge-protocol.ts = contract│
└────────────────────────────┘  └──────────────────────────────┘
```

- **RPC interface**: every editor operation is an engine console command
  (`/crdt_snapshot`, `/set_component`, `/highlight`, `/freeze_scene`,
  `/register_content`, …) invoked through `engine_console_command_args`, plus
  the page↔scene message bus (`/editor_send`, `/editor_poll`) whose message
  types are defined in `editor-scene/src/bridge-protocol.ts`. Anything that can
  issue those calls — this app, a browser tab, a future native-engine host —
  gets the full editor.
- The scene being edited runs under its own `sdk-commands start --data-layer`
  server; saves go through the data layer to `assets/scene/main.composite`.

## Run

```
npm install
npm start
```

Open a scene folder (any SDK7 project with a `scene.json`). The app will:

1. serve the bevy web build (`../bevy-explorer/deploy/web`) on `:3010` with the
   COOP/COEP headers wasm threads need,
2. start the editor system scene (`../editor-scene`) on `:8005`,
3. start the scene's own dev server with `--data-layer` on `:8004`,
4. load the editor.

Ports already in use are assumed to be the right servers and reused, so a dev
running the stack from terminals can use the app as just a window.

## Config

`~/Library/Application Support/bevy-editor-app/config.json` (or env overrides
`BEVY_WEB_DIR`, `EDITOR_SCENE_DIR`, `BEVY_WEB_PORT`, `SCENE_PORT`,
`EDITOR_SCENE_PORT`). Defaults assume the sibling checkouts
`../bevy-explorer` and `../editor-scene`.
