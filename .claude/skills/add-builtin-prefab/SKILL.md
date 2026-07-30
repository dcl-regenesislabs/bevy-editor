---
name: add-builtin-prefab
description: Author a new built-in prefab shipped with the editor (packages/desktop/prefabs/). Use when asked to add, port, or modify a built-in prefab, smart item, or ready-made scene object (e.g. "add a jukebox prefab", "port the X smart item from the creator-hub").
---

# Add a built-in prefab

Built-in prefabs are plain folders in `packages/desktop/prefabs/<slug>/` — no code
registers them; the library lists any folder there containing a `data.json`. They
ship read-only with the app and are copied into a scene's `custom/<slug>/` when
placed, so the folder must be fully self-contained.

Read `docs/PREFABS.md` first — it is the format spec. Canonical examples:
- `packages/desktop/prefabs/video-screen/` — minimal: model + components only.
- `packages/desktop/prefabs/admin-tools/` — maximal: config component + `.tsx`
  script tree + bundled icons + permissions.

## Folder anatomy

```
packages/desktop/prefabs/<slug>/
  data.json          { id, name, category: "custom", tags, origin: {source:"builtin"},
                       requiredPermissions? }
  composite.json     { version: 1, components: [{ name, data: { "<localId>": { json } } }] }
  thumbnail.png      optional but wanted (cards show a glyph without it)
  *.glb / icons/…    every asset referenced, path-referenced as {assetPath}/…
  scripts/…          script files, referenced as {assetPath}/scripts/<file>.ts(x)
```

## Hard rules (each one is load-bearing — violating them fails silently at runtime)

1. `data.json.id` is a fixed UUID generated once (`uuidgen`), never reused across
   prefabs, never changed after ship — placed instances resolve provenance by it.
2. Component names in `composite.json` are **composite names** (`core::Transform`,
   `asset-packs::…`, `core-schema::Name`) and every one must resolve through
   `snapshotComponentName` (packages/scene/src/composite.ts) — unknown names are
   skipped at placement and REJECTED by the import validator. Do not use
   `inspector::Config` or `core-schema::Sync-Components` (deliberately unsupported).
3. Custom-component field order must match `packages/scene/src/custom-registry.ts`
   exactly — the LWW byte encoding depends on insertion order.
4. Local entity ids: single entity = `"0"`; multi-entity = roots `512+index`,
   others `512+rootCount+n`. A single-root prefab normally omits its root
   Transform (drop position supplies it) — include one only to ship a
   scale/rotation, its position is overridden at drop.
5. Entity refs: `{self}` for the owning entity (also inside
   `videoTexture.videoPlayerEntity`); `{entity:<localId>}` for another in-prefab
   entity; `{self:asset-packs::Actions}` / `{<localId>:asset-packs::Actions}` in
   Trigger refs. Never raw engine ids.
6. Every resource path in components uses `{assetPath}/…` and the file must exist
   in the folder. No CDN URLs for anything the prefab needs to work (https://
   media sources like stream URLs are fine as *defaults*).
7. Scripts follow the ScriptComponent contract: a class
   `constructor(public src: string, public entity: Entity, ...typedParams)` with
   `start()` / `update(dt)`; the module must export EXACTLY ONE function-valued
   binding (the class) and must NOT export a function named `start`. Note
   sdk-commands passes the script's *directory* as `src`. Resolve bundled assets
   relative to the prefab root (see admin-tools `scripts/icons.ts`).
8. Anything the script calls that needs scene permissions (signedFetch → 
   `USE_FETCH` + `USE_WEB3_API`, comms → `USE_WEBSOCKET`, `movePlayerTo` →
   `ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE`) must be listed in
   `data.json.requiredPermissions` — placement merges them into scene.json.

## Porting from the creator-hub

The Hub's smart items live in
`../creator-hub/packages/asset-packs/packs/*/assets/<item>/` — copy their
composite shapes and models, but: strip `inspector::Config` and
`core-schema::Sync-Components`, bundle any CDN-loaded textures into the folder,
and replace `@dcl/asset-packs` runtime behaviour with a self-contained script
(see admin-tools; do NOT port the Actions interpreter — dispatch the named
action off the target's `asset-packs::Actions` instead).

## Validation (all required before done)

1. Extend `packages/ui/src/prefabs/builtin.test.ts` with a `describe` block for
   the new prefab, following the existing ones: builtin origin + stable id, all
   component names known, referenced files exist, required permissions declared.
2. If the prefab has scripts: they are typechecked by
   `packages/desktop/prefabs/tsconfig.json` — run
   `npx tsc --noEmit -p packages/desktop/prefabs/tsconfig.json`.
3. `npm run typecheck` and `npm test` clean from the repo root.
4. Add the prefab to the list in `docs/PREFABS.md` and, if creator-facing
   behaviour changed, a short row in `README.md`.
5. Manual check when a dev server is available: place it from the Built-in
   section, verify it renders, then enter play mode and verify the behaviour.

Code style everywhere: no `as any`, no dynamic `import()`, zero comments in TSX,
sparse comments elsewhere.
