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
  thumbnail.png      REQUIRED — builtin.test.ts fails without it; cards must
                     never make the creator guess what they're placing (porting
                     from the Hub: copy the item's own thumbnail.png)
  *.glb / icons/…    every asset referenced, path-referenced as {assetPath}/…
  scripts/…          script files, referenced as {assetPath}/scripts/<file>.ts(x)
  ai.md              REQUIRED iff scripts/runtime/ exists — the AI assistant's
                     guide to this prefab, see below
```

## The AI guide — ai.md

A prefab that carries `scripts/runtime/` modules exposes an API other scripts
import, so it ships `ai.md` in its folder — `guides.test.ts` enforces this in
both directions (a folder without runtime modules must NOT carry one; the seats
stay guide-free). The file is copied into the scene with everything else and the
in-app assistant is pointed at `custom/<slug>/ai.md` whenever the copy is in the
project — it documents the exact copy on disk, so it cannot desync from what the
creator has.

Rules:
- MOVE, never duplicate. A rule lives in `DCL_SYSTEM_PROMPT`
  (`packages/desktop/src/ai.ts`) or in the guide — never both; two copies aging
  separately is how prompt contradictions happen. `guides.test.ts` lint-bans the
  per-prefab vocabulary from `ai.ts`. The sole exception: a scene-breaking NEVER
  may sit tersely in core with its rationale in the guide.
- Budget: hard cap 6 KB (test), target ≤ 4 KB. Every line competes with the
  user's request in a paid, latency-bound context.
- Required shape, in order: YAML front-matter (`prefab: <folder>` plus
  `claims-globals:` / `claims-rpc:` / `claims-messages:` for every wire name or
  `globalThis` key this folder DEFINES — uniqueness is tested across all
  guides), `# <Name> — AI guide` + one-line purpose, `## When to use`, `## API`,
  optional extra sections, `## Do / Don't`, `## Example` (one).
- A guide documents ONLY this folder: shared runtime modules are documented once
  in their master's header (`packages/desktop/runtime-modules/`) — link to "the
  module header in this folder", never restate signatures. Another prefab's
  semantics get a conditional pointer ("if placed, read `custom/<slug>/ai.md`").
- Import paths are written as "normally at `custom/<slug>/…`, check what is on
  disk" — the project slug comes from `data.json.name`, not the folder name
  (`trigger-zone-server` installs as `custom/zone_authority/`), a second copy is
  `_2`, and the folder does not exist until a `placePrefab` request runs at turn
  end.
- Write for a model that has NOT read the source: name every path, no "see
  above", and never reference the inspector UI for things the assistant does via
  `.editor/requests.json`.
- Changing script params or the API means updating `ai.md` in the SAME commit and
  bumping `data.json.version` with a changelog entry — the Update chip is what
  carries the fix to existing scenes. This applies to editing `ai.md` alone, too.

Validation: `guides.test.ts` asserts existence, section order, the size cap,
claim uniqueness, and that every inspector param name appears in the guide.
Then smoke it: place the prefab in a dev scene, ask the assistant the guide's
"When to use" request verbatim, and check the produced code against the
`## Example`. There is no automated prompt-eval yet — the smoke test is the bar.

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
8. Scripts are type-checked twice: against this repo's SDK pin (CI) and by each
   scene project's OWN tsc, whose pin may be older. Stick to long-stable SDK
   surface — a freshly added prop (e.g. `UiTransformProps.scrollVisible`) breaks
   the scene build of every project on an older pin.
9. Anything the script calls that needs scene permissions (signedFetch → 
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

1. `packages/ui/src/prefabs/builtin.test.ts` already sweeps every folder for the
   basics (builtin origin, unique id, known component names, thumbnail present,
   `{assetPath}` files shipped) — nothing to add for those. Add a `describe`
   block for what is specific to the new prefab: its permissions, its script
   wiring, the entity shape its script expects.
2. If the prefab has scripts: they are typechecked by
   `packages/desktop/prefabs/tsconfig.json` — run
   `npx tsc --noEmit -p packages/desktop/prefabs/tsconfig.json`.
3. `npm run typecheck` and `npm test` clean from the repo root.
4. Add the prefab to the list in `docs/PREFABS.md` and, if creator-facing
   behaviour changed, a short row in `README.md`.
5. Manual check when a dev server is available: place it from the Built-in
   section, verify it renders, then enter play mode and verify the behaviour.
6. If the prefab carries `scripts/runtime/`: write/update `ai.md` and keep
   `packages/ui/src/prefabs/guides.test.ts` green.

Code style everywhere: no `as any`, no dynamic `import()`, zero comments in TSX,
sparse comments elsewhere.
