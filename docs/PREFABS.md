# Prefabs

A prefab is a group of entities with components, saved as a self-contained folder
and placed by copy. It is the editor's reuse unit: a door, a lift, a whole admin
panel. Logic rides along on the existing `asset-packs::Script` component — there
are no prefab-specific engine objects, no runtime library and no npm dependency
in the scene.

This is the engineering doc. The creator-facing description lives in `README.md`.

Prior design notes are in `docs/PREFABS-RESEARCH.md`; where the two disagree,
this file wins — the research doc still describes an earlier
`assets/prefabs/<name>/prefab.json` sketch that was dropped in favour of the
Creator Hub format below.

## Design decisions

1. **A prefab is only entities + components.** No special engine objects.
2. **Copy-on-place, no live link.** Editing a prefab does not change instances
   already placed, and editing an instance does not change the prefab. The only
   thing an instance remembers is where it came from:
   `inspector::CustomAsset { assetId }` stamped on its root.
3. **The on-disk format is the Creator Hub custom-asset folder, verbatim**, so
   folders round-trip between this editor and the Hub.

## Folder format

One prefab is one folder. In a project it lives at `<project>/custom/<slug>/`;
the slug is deduped `_2`, `_3`, … so a second "Door" never overwrites the first.

```
custom/door/
  data.json        { id, name, category: "custom", tags, origin?, requiredPermissions?,
                     requiresSdk?, spawnable? }
  composite.json   { version, components: [{ name, data: { "<localId>": { json } } }] }
  thumbnail.png    optional
  ai.md            the AI assistant's guide to this prefab — required iff the
                   folder carries scripts/runtime/ modules (see below)
  models/door.glb  bundled resources, relative structure preserved
  scripts/door.ts
```

`composite.json` is the Hub's asset composite, **not** `main.composite`: it
carries no embedded `jsonSchema`, and its component names are composite-side
(`core::Transform`, `core-schema::Name`, `asset-packs::Script`). The editor's
snapshot keys protocol components by their SDK export name (`Transform`), so
every read and write goes through `compositeComponentName()` /
`snapshotComponentName()` in `packages/scene/src/composite.ts`.

`data.json.id` is a uuid and is the identity an instance points at. Renaming a
prefab rewrites `name` only — the folder is never moved, because instances
resolve their `{assetPath}` resources through it.

`parsePrefabData` is a **whitelist**: a field the parser does not read is
dropped on the next write. A new key must land as a type and a parse branch in
the same edit, or the feature fails silently with no error anywhere.

### Spawnable prefabs

`data.json.spawnable = { max: 1..1024, instancing?: 'onDemand' | 'perPlayer' }`
marks a prefab as one that scripts clone at runtime. It changes nothing about
the folder — the same composite is placed by hand and cloned by code — but the
editor then regenerates `src/scripts/spawnables.ts`, a table of snapshots
compiled from every spawnable folder, installed as one `asset-packs::Script`
row on entity 0 at priority `-100` and published at module scope. Clones are
built by `runtime/spawner.ts`, vendored beside it.

The `-100` buys nothing on its own and nothing may depend on it: script priority
orders `engine.addSystem` update systems only, it sorts **descending** (so −100
runs LAST, not first), and `start()` order is unrelated to it. The registry is
correct because `registerSpawnables()` runs at module scope, and every module
body evaluates before the first `start()`.

Two things are deliberately NOT in `data.json`:

- **the sync mode.** `'server'` / `'planned'` / `'seeded'` / `'perPlayer'` is an
  argument at pool-open, so it is a property of the consumer, not of the prefab.
  The guarantee chips a card shows are derived by scanning consumers.
- **`core-schema::Name`**, which is stripped from every snapshot entity: clones
  must never bind name-keyed lookups, since every clone would answer to the same
  name.

`max` is a hard cap on concurrently-alive clones. Releasing a client-local clone
deletes its entities and the next acquire builds fresh from the snapshot, so
"release then re-acquire" is a clean slate by construction; only a `'server'`
pool (single entity in v1, because its synced id must stay stable) reuses one.

The generated registry also carries `import './game-config'` whenever
`src/scripts/game-config.ts` exists. Nothing else imports it, and a module no
bundle entry reaches never runs — without that line `__dclGameConfig_v1` is never
published and every kit prefab silently falls back to its hard-coded defaults.

### Placement

Placement is a **derived** state, never stored: it is read back from the scene as
(does the project hold an instance of this prefab?) × (does that instance carry
`inspector::Inert`?). The three answers are `Unplaced`, `Editor & Play` and
`Editing only`, and one derivation (`prefabs/placement.ts`) feeds the property
sheet, the card chip, the hierarchy badge and the scene check, so they cannot
disagree.

"Editing only" is two markers written together — `inspector::Hide` so the editor
stops drawing it, `inspector::Inert` so the save leaves it out — in a single undo
step. The projection (`packages/scene/src/inert.ts`, called once at the top of
`buildComposite`) covers the marked entity **and its whole Transform subtree**,
dropping `asset-packs::Script`, `MeshCollider` and `TriggerArea` and forcing
`VisibilityComponent {visible:false}`. The live snapshot is untouched, which is
what keeps the inspector honest and makes Save-over-prefab recapture clean.

Right-click a project prefab → **Placement & spawning…** opens the sheet. Turning
Spawnable on asks whether to keep a placed anchor; the default is yes for a
per-player prefab or a small pool, and a kept anchor is **Editor & Play** for
anything with a server half.

### Scene checks

`features/editor/scene-checks.ts` is a registry of pure lints over the project
(prefab folders, script texts, the scene snapshot, the Game Config). Eight ship
today: `wave-count-vs-pool-max`, `config-shadowing`, `stale-anchor`,
`server-pool-multi-entity`, `bespoke-script-on-kit-instance`, `empty-prefab-ref`,
`editing-only-server-half`, `spawnable-trigger-area`. A `blocker` or
`play-blocker` finding stops Play with the card's "Play anyway" as the one-press
override. This is deliberately NOT `scene-health.ts`, which parses the dev
server's log stream — different question, different source.

### Local entity ids

Authored entity ids inside a prefab follow the Hub's convention exactly:

| case | ids |
| --- | --- |
| single entity | `"0"` |
| multiple | roots at `512 + index`, everything else at `512 + rootCount + n` |

A **single-root** prefab omits its root `Transform` entirely — the drop position
supplies it at instantiation. A **multi-root** prefab keeps each root's
Transform with its position rebased on the selection centroid, and instantiation
creates one container entity to hold the group together.

### Placeholders

Two substitution schemes travel in the composite.

**`{assetPath}`** — every project file path, rewritten at capture and resolved to
the prefab folder at instantiation. Rewritten at:

- `GltfContainer.src`, `AudioSource.audioClipUrl`, `VideoPlayer.src`
- `Material` pbr `texture` / `alphaTexture` / `emissiveTexture` / `bumpTexture`,
  and unlit `texture`
- `asset-packs::Script` `value[].path`
- `src` inside an Action's `jsonPayload` for `show_image`, `play_custom_emote`
  and `play_sound`

`https://` values are left alone. Paths are made relative to the *common base
path* of everything captured, matching the Hub.

**Entity/component refs** — id-bearing components (`asset-packs::Actions`,
`States`, `Counter`) store `id: "{self}"`. A Trigger's `actions[].id` /
`conditions[].id` become `{self:asset-packs::Actions}` when they point at their
own entity and `{<localId>:asset-packs::Actions}` when they point at another
entity in the prefab.

**Script layout entity params** (an addition over the Hub, which does not remap
them at all). `Script.value[].layout` is a JSON *string* of
`{ params: { name: { type, value } }, actions }`. A param with `type: "entity"`
holds a raw engine id, which is meaningless outside the scene that produced it;
it is stored as the marker `{entity:<localId>}` and re-resolved on placement. A
param with `type: "action"` gets the `.entity` of its `{ entity, action }` value
remapped the same way.

### Never captured

Editor-only state, the same exclusion list the Hub uses:
`inspector::Selection`, `Nodes`, `TransformConfig`, `Hide`, `Lock`, `Ground`,
`Tile`, `CustomAsset`, and `core-schema::Network-Entity`.

Code-spawned entities are excluded too, subtree and all (`authoredOnly` in
`capture.ts`, keyed on `isRuntimeEntity` against the provenance baseline). The
script that spawned them ships with the prefab and recreates them on every run —
a baked copy would double them at runtime and strand hundreds of orphans in the
scene root when the instance is deleted. Capture reports how many were left out;
a selection that is entirely code-spawned is refused.

### AI guides (`ai.md`)

A prefab whose scripts expose an API other scripts import ships `ai.md` next to
its `data.json`. It is prefab content like any other file: `copyTree` carries it
into `custom/<slug>/` with zero extra plumbing, `.origin-hashes.json` covers it,
the Update chip refreshes it, and it deploys with the scene. Because the copy
travels with the folder, a guide always describes the exact code on disk in that
project.

The rule is a biconditional, enforced in `packages/ui/src/prefabs/guides.test.ts`:
**`ai.md` exists iff `scripts/runtime/` exists.** Carried runtime modules are what
makes a prefab something other scripts talk to (`zoneBus`, `timeSync`, `rpc`), and
it auto-forbids a guide on the 23 seats and on admin-tools, which expose no API.

| property | rule |
| --- | --- |
| front-matter | `prefab: <folder>`, plus `claims-globals:` / `claims-rpc:` / `claims-messages:` naming every `globalThis` key, rpc method or comms message the folder DEFINES. Tested globally unique — a wire-name collision between two prefabs is a failing test, not a runtime mystery. |
| shape | `# <Name> — AI guide` + purpose, `## When to use`, `## API`, optional extras, `## Do / Don't`, `## Example`. Order is tested. |
| size | hard cap 6,144 bytes, target ≤ 4 KB. The cap is what stops the monotonic growth that made the old system prompt unmaintainable. |
| duplication | MOVE, never duplicate: a rule lives in `DCL_SYSTEM_PROMPT` (`packages/desktop/src/ai.ts`) or in a guide, never both. `guides.test.ts` lint-bans per-prefab vocabulary from `ai.ts`. |
| params | every inspector param name of every script the composite references must appear in the guide (word-boundary matched, so a rename fails the test). |

The assistant is told which guides exist, not what they say: `PrefabEntry.hasGuide`
feeds `buildGuideIndex` (`packages/ui/src/ai/roster.ts`), which emits one
`[Prefab guides]` line per project copy — folder, name, version, truncated
description, guide path — and the core prompt makes reading the guide mandatory
before touching that prefab. The prompt therefore stays O(1) in prefab count.
`docs/AI-ASSISTANT.md` has the assistant-side detail; the authoring rules are in
`.claude/skills/add-builtin-prefab/SKILL.md`.

Shared runtime modules are documented once, in the master's header comment in
`packages/desktop/runtime-modules/` — carried copies are byte-identical by test,
so "the module header in this folder" points at the same text in every consumer.
Guides link there instead of restating signatures.

## Provenance

`data.json.origin` is this editor's extension field (the Hub ignores it):

```jsonc
{ "source": "builtin" | "user" | "import" | "github",
  "url": "…", "commit": "…", "author": "…", "importedAt": "…",
  "project": "…" }  // the scene (scene.json display.title) the prefab was created in
```

| source | meaning | badge |
| --- | --- | --- |
| `builtin` | ships with the app, read-only in the library | Built in |
| `user` | the creator made it | Made here |
| `import` | came from a folder or a `.zip` someone shared | Imported |
| `github` | fetched from a GitHub URL, pinned to a commit SHA | GitHub |

Provenance is a fact, not a label: saving an imported prefab to the library
**keeps** its `import`/`github` origin rather than restamping it as `user`. Only
a prefab with no origin (or one already `user`/`builtin`) becomes `user` — and
the record's other fields (like `project`) ride along untouched.

Creating a prefab **always files it into the cross-scene library too** (desktop;
the web build is project-only). A project deleted from the terminal must not
take the only copy with it. The origin's `project` field names the scene it was
made in, shown as "made in <scene>" on library cards.

## Versioning

`data.json` optionally carries `version` (semver string) and
`changelog: [{ version, notes }]`; every built-in ships both, and
`builtin.test.ts` enforces that the latest changelog entry matches `version`.
`compareVersions` in `format.ts` is the one comparator (missing = `0.0.0`).

Copying a library prefab into a project also writes
`custom/<slug>/.origin-hashes.json` — sha256 of every copied file, hashed
renderer-side over the data-layer (dotfiles excluded). That manifest is how
`updatePrefabCopy(id)` (`prefabs/update.ts`) tells local edits from pristine
master files: with modified files and no `force`, it reports them and writes
nothing; with no manifest at all, every carried script is reported as
potentially modified. The update itself overwrites the copy in place (main-side
`overwriteProjectCopy` — the folder path never changes, instances resolve
resources through it), writes a fresh manifest, then re-merges the Script
layout of every placed instance whose `CustomAsset.assetId` matches: fresh
parse supplies params and defaults, edited values survive by name (the same
`mergeLayout` the Script inspector's refresh uses).

`prefab-store.ts` exposes `outdated` — project copies older than the built-in
master with the same id, each with the changelog entries the copy is missing
(`prefabs/outdated.ts`). The idempotent copy-in path reports `outdatedReuse`
when it hands back a stale existing copy, and placement says so in the status
toast.

The UI for all of this is an "Update" chip on the project card in the Prefabs
tab and an "Update available" chip on the inspector's "Instance of…" strip;
both open `panels/PrefabUpdate.tsx` — the version jump, the missing changelog
entries, and Update/Cancel. When `updatePrefabCopy` reports locally-modified
files the dialog lists them and swaps the button for a two-step
`ConfirmButton` that re-runs with `force`.

## Library

The library is a *source*, never a runtime dependency — a scene never reads from
it. Placing any library prefab copies its folder into the project's `custom/`
first, so a scene is always self-contained and deployable.

| scope | location |
| --- | --- |
| `builtin` | `packages/desktop/prefabs/` in dev, `resources/prefabs/` when packaged |
| `user` | `<userData>/prefabs/<name>/` |
| staging | `<userData>/prefab-imports/<token>/`, wiped at every app start |

Adding a built-in prefab is adding a folder — nothing registers it in code.

The library is owned entirely by the Electron main process
(`packages/desktop/src/prefab-library.ts`, plain `fs`), reached over IPC. Bytes
never cross IPC: main copies folders directly between the library and the project
directory. That deliberately bypasses the data-layer; the dev server watches the
disk and `ensureContentMapped` covers the engine's content map, so it is
invisible in practice, but it is the one write path in the prefab system that
does not go through the RPC.

Copy-in is idempotent per project: if `custom/*/data.json` already holds that
prefab id, the existing folder is reused. Consequence — if you edit your project
copy and place the library prefab again, you get your edited copy.

### Import

Two paths, both staged and both requiring an explicit confirmation:

- **folder / `.zip`** — OS picker, extracted with `bsdtar` (with an `unzip`
  fallback), symlinks / `node_modules` / `.git` stripped.
- **GitHub URL** — repo or `/tree/` subfolder. `api.github.com` resolves the ref
  to a SHA, the tarball comes from `codeload`, and the recorded origin pins that
  commit.

Caps enforced before anything is copied: 2,000 files, 200 MB.

The confirmation dialog lists entity and file counts, `requiredPermissions`,
component names this editor does not know, and **every script file the prefab
carries, with expandable source** (truncated at 8,000 chars, at most 400 files
listed). An import whose composite names a component outside
`packages/scene/src/custom-registry.ts` (or the SDK protocol set) is **rejected**
— placing it would silently drop those components and leave a prefab that looks
fine and does nothing. The security value of the script preview is disclosure,
not sandboxing: an imported script runs with everything the scene can do.

## Permissions

A prefab that needs scene permissions declares them in
`data.json.requiredPermissions`. Instantiation merges them into the project's
`scene.json` through the data-layer and reports what it added in the toast. The
merge is additive only — nothing is ever removed.

## Instantiation

`instantiatePrefab(folder, position)` in `packages/ui/src/prefabs/instantiate.ts`:

1. read + parse the folder, substitute `{assetPath}` → `custom/<slug>`
2. `ensureContentMapped` every `.glb`/`.gltf` so the engine can resolve it
3. `allocateNamedEntities` for fresh ids (names deduped against the scene)
4. allocate component ids off `asset-packs::Counter` on entity 0 — the same
   counter the Hub uses, so ids stay unique across both tools
5. write every component with `writeComponent`, remapping `Transform.parent`,
   trigger refs and script layouts to the new ids
6. inject the root Transform at the drop position (or a container for a
   multi-root prefab)
7. stamp `inspector::CustomAsset { assetId }` on the root
8. merge `requiredPermissions` into `scene.json`

Every write goes through `packages/scene/src/inspector.ts`, so undo, autosave and
the BroadcastChannel bus mirror come for free.

## Known limitations

- **Placing a prefab is not one undo step.** The entities a placement creates are
  not recorded in history — only the component writes are, one step each — so ⌘Z
  strips the copy's components instead of removing it, and redo is not a round
  trip. Delete the instance instead of relying on undo. (Deleting *is* one step:
  `captureEntityDelete` takes the subtree first and undo re-creates it, under
  fresh engine ids.)
- **Out-of-subtree references are nulled, not preserved.** A Trigger, a script
  entity param or a `Transform.parent` pointing outside the captured selection is
  cleared (to `null`, `0` or the scene root) with a warning. The Hub throws here;
  we warn, because a partial capture is more useful than a refused one.
- **Deleting a prefab breaks instances already placed from it.** Instances point
  at `custom/<slug>/…` for their models, textures and scripts — instantiation
  does not copy resources a second time. The confirm dialog says so.
- **Resources from divergent trees collide by basename.** When captured files
  live in unrelated folders (`models/door.glb` + `src/scripts/door.ts`) the
  common base path is empty and every file bundles at the prefab-folder root by
  filename. Two files with the same basename overwrite each other. This is
  Creator Hub behaviour, kept for round-trip fidelity.
- **Material video textures ARE remapped** (`videoPlayerRefSites` in
  `format.ts`): capture writes `{self}` for a self-reference and
  `{entity:<localId>}` for another in-prefab entity (a raw number is ambiguous —
  local id 0 vs. cleared); instantiate resolves both and leaves foreign raw
  numbers alone. Out-of-prefab refs are cleared with a warning.
- **`core-schema::Sync-Components` is not written.** The Hub stores component
  *names* there, which is its inspector's representation, not the SDK's
  `{ componentIds: number[] }` schema. Scripts that need sync call `syncEntity`
  themselves.
- **A GitHub ref with a slash is misread.** `parseGithubPrefabUrl` assumes a
  single-segment ref, so a branch named `feat/x` is parsed as ref + subpath and
  404s. Use a tag or a SHA.
- **There is no editor-side avatar mannequin.** A prefab anchored to the avatar
  (the Player Rig's hand and head anchors) has nothing to preview against while
  the scene is stopped — spawning non-authored viewport entities has no
  affordance today. The Player Rig ships its hand anchor pre-positioned at the
  documented right-hand offset instead, and hand-relative placement previews in
  Play. Its `ai.md` and card description say so.
- **An "Editing only" instance loses its script on the server too.** The
  save-time projection that suppresses inert ghosts drops `asset-packs::Script`
  from the built composite, so a prefab whose server half matters (the Player
  Rig's hit points) must be placed **Editor & Play**. The property sheet now
  defaults that way for anything with a server half, and the
  `editing-only-server-half` scene check flags an instance that is ghosted
  anyway — both off the one predicate, `keepsServerHalf` in `prefabs/placement.ts`.
- **Guarantee chips read the code textually, not through a type checker.** A
  pool opened on a local (`openPool(ref, 'seeded')`, where `ref` came out of
  `this.arenas` three functions ago) is attributed to every prefab that script's
  own `PrefabRef` params point at. The chips refresh on panel mount, on a
  prefab-list change and on the reload button — not on every script save.
- **A clone drops a component the scene bundle never defined.** SDK components
  are defined lazily on first use, so `spawner.ts` logs `[spawner] unknown
  component 'core::Billboard' — clones will not carry it` for anything the
  scene's own code never imports. Placed copies are fine; clones lose it. The fix
  is for the generated registry to reference the components its snapshots name,
  which needs a name→export table it does not have yet.
- **`gun-hitscan.ts`'s `range` param collides with a `weapons.range` column.**
  Under the natural table naming the `config-shadowing` check fires on a kit
  param. The zombie-arena fixture dodges it by naming the row `gunRange`; the
  real fix is renaming the kit param.
- **Nothing renders in a test.** `vitest` runs with `environment: 'node'` and the
  repo has no `.test.tsx`, so `PrefabSheet.tsx`, `TableEditor.tsx`,
  `SceneChecksCard.tsx` and `game-config-view.tsx` are typechecked and linted but
  never mounted.
- **`storage.ts` and `instantiate.ts` have no unit tests.** They are data-layer
  and engine IO with no test doubles in this repo; only the pure modules
  (`format.ts`, `capture.ts`, `provenance.ts`) and the shipped built-in prefab
  are covered.

## Code map

| file | role |
| --- | --- |
| `packages/ui/src/prefabs/format.ts` | the format itself — ids, placeholders, refs, layout remap, parsers. Pure. |
| `packages/ui/src/prefabs/capture.ts` | selection → composite + resource list. Pure. |
| `packages/ui/src/prefabs/storage.ts` | folder read/write/rename/delete over the data-layer |
| `packages/ui/src/prefabs/instantiate.ts` | composite → live entities |
| `packages/ui/src/prefabs/library.ts` | renderer half of the global library + import |
| `packages/ui/src/prefabs/provenance.ts` | origin labels and detail lines. Pure. |
| `packages/ui/src/prefabs/versioning.ts` | manifest shape, modified-file diff, layout merge. Pure. |
| `packages/ui/src/prefabs/outdated.ts` | copy-vs-master version comparison. Pure. |
| `packages/ui/src/prefabs/hashes.ts` | `.origin-hashes.json` IO + sha256 over the data-layer |
| `packages/ui/src/prefabs/update.ts` | update a project copy to the built-in master |
| `packages/ui/src/prefabs/spawnable.ts` | `data.json.spawnable` reads/writes and the clone snapshot compiler. Pure. |
| `packages/ui/src/prefabs/codegen.ts` | renders `src/scripts/spawnables.ts` + the generation-time lint. Pure. |
| `packages/ui/src/prefabs/vendoring.ts` | runtime-import extraction, transitive closure, import rewriting. Pure. |
| `packages/ui/src/prefabs/generate.ts` | the registry write: render, vendor the runtime, install the entity-0 Script row |
| `packages/ui/src/prefabs/drift.ts` | instance-vs-folder structural diff (`.origin-hashes.json` keeps its folder-*file* job). Pure. |
| `packages/ui/src/prefabs/placement.ts` | the three placement states, the server-half predicate, the anchor default. Pure. |
| `packages/ui/src/prefabs/guarantees.ts` | pool-open scan → guarantee chips; mode is read off the consumer, never `data.json`. Pure. |
| `packages/ui/src/prefabs/consumers.ts` | the impure half of the above: every project script's text, cached |
| `packages/ui/src/panels/PrefabSheet.tsx` | the property sheet: Placement, Spawnable, Instancing, Guarantees |
| `packages/ui/src/actions/ghost.ts` | placement writes — the two ghost markers in one undo step |
| `packages/ui/src/panels/views/prefab-options.ts` | `PrefabRef` dropdown options, including a ref that stopped being valid. Pure. |
| `packages/ui/src/panels/views/script-params.tsx` | the param editors, incl. the prefab and prefab-list pickers |
| `packages/ui/src/features/editor/scene-checks.ts` | the check registry, the findings store and the Play gate |
| `packages/ui/src/features/editor/scene-check-model.ts` | how a project is read for a check: script rows, instances, spawner calls. Pure. |
| `packages/ui/src/features/editor/scene-check-rules.ts` | the eight shipped rules and their copy. Pure. |
| `packages/ui/src/features/editor/scene-check-context.ts` | context collection over the data layer + debounce |
| `packages/ui/src/features/editor/SceneChecksCard.tsx` | the card, its fix buttons and "Play anyway" |
| `packages/scene/src/inert.ts` | the save-time "Editing only" projection. Pure. |
| `packages/ui/src/actions/spawnables.ts` | the Spawnable toggle and an explicit regenerate |
| `packages/ui/src/actions/drift.ts` | Save over prefab / Update from prefab |
| `packages/ui/src/panels/PrefabDriftDialog.tsx` | the confirm both drift verbs open |
| `packages/ui/src/gameconfig/normalize.ts` | the `editor::GameConfig` value shape and its column readers. Pure. |
| `packages/ui/src/gameconfig/codegen.ts` | renders `src/scripts/game-config.ts`. Pure. |
| `packages/ui/src/gameconfig/generate.ts` | the game-config write (write-if-changed, composite untouched) |
| `packages/ui/src/panels/views/game-config-view.tsx` | the Game Config inspector view |
| `packages/ui/src/ds/TableEditor.tsx` | the spreadsheet-plus-row-detail DS primitive it renders with |
| `packages/desktop/runtime-modules/spawner.ts` | the clone runner — mirrors the SDK's `runtime-script.js` |
| `packages/desktop/runtime-modules/outcomes.ts` | sequenced, server-validated gameplay events |
| `packages/desktop/runtime-modules/serverState.ts` | server-private state, opt-in `Storage` persistence |
| `packages/desktop/runtime-modules/protectedSync.ts` | synced + server-validated components in one call |
| `packages/desktop/runtime-modules/rng.ts` | seeded draws and the draw-order invariant |
| `packages/desktop/src/runtime-modules.ts` | main-process read of a runtime-module master (guarded) |
| `scripts/sync-runtime-modules.mjs` | writes every prefab's carried `scripts/runtime/` copies |
| `packages/desktop/validate/probe-script-runner.mjs` | the runner-contract probe + SDK fingerprint gate |
| `packages/desktop/validate/probe-zombie-arena.mjs` | the end-to-end walkthrough probe (build → play → plan) |
| `packages/desktop/validate/fixtures/composite-schemas.json` | every custom component's wire schema, so a probe-written composite can be instanced |
| `packages/ui/src/panels/Prefabs.tsx` | the Prefabs panel (a left-dock tab), drop layer, instance strip |
| `packages/ui/src/panels/PrefabUpdate.tsx` | the update dialog both chips open |
| `packages/ui/src/panels/prefab-store.ts` | reactive store shared by the three surfaces |
| `packages/desktop/src/prefab-library.ts` | main-process library + staged import |
| `packages/scene/src/composite.ts` | composite ⇄ snapshot component names |

The module lives in `packages/ui`, not `packages/scene`, because it needs the
data-layer RPC, `gltf-refs` and `ensureContentMapped` — none of which can be
imported into the sdk-commands-compiled scene bundle.

## Built-in prefabs

Shipped in `packages/desktop/prefabs/` (no registration — the library lists any
folder there with a `data.json`). To add one, follow the
`add-builtin-prefab` skill (`.claude/skills/add-builtin-prefab/SKILL.md`).

- **admin-tools** — the Admin Tools panel (below).
- **23 seats** (`wooden-chair`, `classic-bench`, `large-couch`, …, plus two
  model-less spots: `sit-spot` to parent under any imported furniture, and
  `sit-spot-edge` for ledges/pool rims) — ports of the Hub's Seats category,
  collapsed into one browsable "Seats" card in the Prefabs tab via `data.json`'s
  optional `group` field (any prefabs sharing a `group` value render as a single
  drill-down card; a text filter searches the members flat). Each is a GLB root
  plus hidden "Sit Spot" child entities carrying only a Transform; the bundled
  `scripts/seat.ts` gives every spot its pointer collider and hover at runtime,
  then sits the player with `movePlayerTo` onto the spot plus a looping emote —
  the predefined `sittingChair1/2` via `triggerEmote` by default, or the
  scene-bundled emote `.glb`s listed in the script's `SCENE_EMOTES` const via
  `triggerSceneEmote` (how `sit-spot-edge` gets Genesis Plaza's
  `Sit_Edge1/2_emote.glb` legs-dangling pose). The Hub's and Genesis Plaza's
  exact mechanism — no AvatarAttach; walking cancels the emote engine-side.
  Declares `ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE` + `ALLOW_TO_TRIGGER_AVATAR_EMOTE`.
  No seat reservation (matching Plaza; the Hub's Taken state needs synced
  state — deferred). Because a sit spot is invisible at runtime, the editor
  draws a ghost seated persona over every "…Sit Spot…" entity while the scene is
  stopped (`packages/scene/src/viewport/seat-marker.ts`).
- **video-screen** — a port of the Hub's `video_screen` smart item: GLB screen,
  `VideoPlayer` with a default stream, `GltfNodeModifiers` streaming the material
  from its own player via `videoTexture.videoPlayerEntity: "{self}"`, and an
  `asset-packs::VideoScreen` config the admin message bus seeds from. Place one
  (or several) and link them in the Admin Tools inspector — or turn on "Link all
  video players".
- **server-clock** — first of the multiplayer game kit: a `TextShape` that shows
  the Multiplayer Server's clock, NTP-synced and identical for every player.
  Requires an authoritative scene (any scene created from the current templates).
  Its script carries its own server half (`initTimeSync()` registers the
  server-side responder) and its own copies of the runtime modules it imports
  (`scripts/runtime/` ⊂ `packages/desktop/runtime-modules/` masters — the
  carried-module model: prefabs bring exactly the modules they need, templates
  ship zero runtime code, and `builtin.test.ts` fails if a copy drifts from its
  master). Script params: `label`, `utc`, `display` (`'3D text'` shows floating
  text at the entity; `'2D UI'` removes the TextShape and renders a screen
  overlay via react-ecs `addUiRenderer`, so it coexists with admin-tools and
  any other UI) and `position` (where the 2D overlay sits). No permissions.
  Grouped in the drawer under `Multiplayer Server` with the zone authority. Ships
  `ai.md` (the time-sync API and how to express a shared deadline).
- **trigger-zone** — a named `core::TriggerArea` volume (box, 4×3×4 scale, mask 8
  = the local avatar only) plus `scripts/trigger-zone.ts`. **The zone's id is the
  entity's Name**, matched case- and whitespace-insensitively — there is no
  `zoneId` param, because two spellings of one zone is the silent failure this
  prefab exists to remove. The script owns the entity's
  `triggerAreaEventsSystem` callbacks (the SDK keeps exactly one per
  (entity, event), so a second subscriber silently replaces the detector) and
  publishes occupancy on the zone bus; consumers call `isInZone(name)` /
  `playersInZone(name)` / `onZone(name, kind, fn)` from their own carried copy of
  `runtime/zoneBus.ts`. Params: `who` (`this player` / `any player` → collision
  mask 8 vs 4), `fireWhen` (`every time` / `once per player` / `once ever`) and
  `exitDelay` (exit hysteresis, seconds — deliberately not a "cooldown", which is
  a reaction's own concern). Ships `ai.md`: the guide the assistant must read
  before writing zone code (bus API, where a reaction script goes, sizing).
  Carries `zoneBus.ts`,
  `pure/zoneRegistry.ts` and `pure/membership.ts`. Detection is client-side
  always — the headless server has no avatar colliders, so a zone never fires
  there; server-validated zones are a separate prefab. Serverless: no
  `requiresSdk`, no permissions.
- **trigger-zone-server** ("Zone Authority") — the server half of the zone
  story, for zones that gate something worth cheating for. One invisible entity
  running `scripts/trigger-zone-server.ts`, which starts
  `scripts/zone-authority.ts` on the Multiplayer Server: an rpc handler for
  `zone.enter` that resolves the caller from `context.from` (never the payload),
  recomputes their scene-local position with the carried `playerPositions.ts`,
  and tests it against the named zone's own volume — zones resolved by Name
  through the same `zoneKey()` the client bus matches with. Outside → rejected;
  a caller whose position has not reached the server yet is admitted
  unverified (late-joiner grace) and a 4 Hz sweep drops anyone whose position
  turns up outside, or stays missing for 10 s. Params: `slack` (metres of
  tolerance at the edge, default 1 — positions arrive at ≤10 Hz and are the
  avatar's feet) and `logRejections`. Consumers call
  `verifyZoneEntry(name)` / `verifiedZoneOccupancy(name)` from
  `custom/zone_authority/scripts/zone-authority.ts` — that module owns the
  single `createRpc('zone')` instance, so a consumer must never create its own
  (two instances answer the same request and the first reply wins). Carries
  `rpc.ts`, `playerPositions.ts`, `pure/pending.ts` and `pure/zoneRegistry.ts`.
  `requiresSdk: "auth-server"`, no permissions, and `group: "Multiplayer
  Server"` so it sits behind a group tile instead of beside the Trigger Zone
  card. Ships `ai.md` (the client/server split, the verification API, the
  guarantee wording).

### The Multiplayer Server kit

Five prefabs that compose into a round-based multiplayer game. All are
`requiresSdk: "auth-server"`, `group: "Multiplayer Server"`, need no scene
permissions, and are guarded by `packages/ui/src/prefabs/builtin-kit.test.ts`.
None imports another's folder — they meet on `globalThis` keys and outcome
ledgers, listed in `packages/desktop/runtime-modules/README.md`.

- **round-loop** ("Round Loop") — the phase clock everything else hangs off.
  One server-owned FSM (lobby → wave → intermission → wave → …) published as
  `{seed, phase, phaseStartMs, configVersion}` through the synced,
  server-protected `runtime::RoundPhase` (sync id 3101) and mirrored on
  `globalThis.__dclRoundTuple_v1`. Nothing here is a timer: the server writes a
  phase START and every countdown is `deadline - getServerTime()`, so a client
  joining mid-wave and a server restarting mid-round land on the same phase by
  arithmetic. Parks when the scene empties, rehydrates from `Storage` on a cold
  start, and pins `gameConfig.version` into each phase so a live config edit
  lands on a boundary, never mid-wave. Params: `lobbySeconds`, `waveSeconds`,
  `intermissionSeconds`, `minPlayers`, `soloMode`.
- **level-slots** ("Level Slots") — rotates arena variants. The server draws a
  pick INDEX per slot and syncs only that (`levelSlots::SlotState`, sync id
  8020); every client reconstructs the geometry itself with a `'seeded'` pool.
  That is what keeps it inside the v1 rule that a `'server'` pool is a single
  entity — an arena is a whole subtree. Params: `slotCount`, `arenas`.
- **wave-director** ("Wave Director") — server-owned wave seed, enemy HP ledger
  and hit/bite validators; every client rebuilds the identical spawn plan as a
  pure function of the phase tuple and the pinned config, and clones the
  spawnable prefab named by its `zombie` param. Params: `zombie`, `wavesTable`
  (default `waves`). Ports Dead Surge's wave planner with the room coupling and
  the player-count multiplier stripped — the multiplier would have made the plan
  depend on a roster that differs per client.
- **player-rig** ("Player Rig") — `spawnable: { max: 32, instancing: 'perPlayer' }`:
  one clone per player, `AvatarAttach`ed at the name tag with a nameplate and a
  health bar, plus a hand anchor carrying its own `AvatarAttach` and the hitscan
  gun. Hit points live server-side behind damage / heal / respawn validators
  (cooldown, spawn protection, clamped amount, caller resolved from `from`
  and never from the payload). The health NUMBER is trustworthy; the bar's
  position is cosmetic. The placed anchor must be **Editor & Play** — as
  "Editing only" its server branch is stripped and no player has hit points.
- **leaderboard** ("Leaderboard") — a GLB panel plus a `TextShape` child showing
  a named board. Per-wallet bests in `Storage.player`, the visible table in
  scene Storage, optional weekly rollover. The board's identity is its NAME, so
  two placements of the one folder are two boards. `submitScore` reports a
  client number (range-checked, rate-limited, best-only); `awardScore` is the
  server-side path when the number must be trustworthy.

## The admin-tools prefab

The first built-in prefab is a port of the Creator Hub's `admin_toolkit` smart
item: one entity carrying `asset-packs::AdminTools` (config, edited through the
Admin Tools inspector view) and `asset-packs::Script` pointing at
`{assetPath}/scripts/admin.tsx`.

```
packages/desktop/prefabs/admin-tools/
  data.json          origin builtin; requiredPermissions USE_FETCH, USE_WEB3_API,
                     USE_WEBSOCKET, ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE
  composite.json     one entity "0", no Transform
  icons/             panel chrome + one subfolder per tab
  scripts/
    admin.tsx        panel shell: tab bar, chrome, admin gating, the ONLY
                     function-valued export in the module
    types.ts         TabProps / TabSpec — the contract every tab implements
    state.ts         mutable panel state; react-ecs re-renders off it each frame
    components.ts    the asset-packs components the prefab touches
    api.ts           endpoints + the signedFetch wrapper
    actions.ts       ~100-line local action dispatcher (not the Hub's interpreter)
    message-bus.ts   wallet-validated comms commands + per-frame revert
    icons.ts         iconPath()/createIcons() — every texture path in the prefab
    ui.tsx           shared react-ecs primitives
    tabs/*.tsx       one file per tab, each exporting a TabComponent and a TabSpec
```

Adding a tab is adding a file under `tabs/` and listing its `TabSpec` in
`admin.tsx`'s `TABS` array.

Things worth knowing before touching it:

- **sdk-commands picks the script class with
  `Object.values(module).find(exp => typeof exp === 'function')`.** `admin.tsx`
  must keep exporting exactly one function-valued binding, and must not export a
  `start` function (that switches the runtime to functional-script mode).
- **The `src` constructor argument is the script's *directory*, not its file
  path.** `assetBase()` handles both; the shell derives the prefab root from it
  and passes it to every tab as `TabProps.assetBase`. Tabs build texture paths
  with `iconPath(base, 'video/eye.png')` — never hardcode `icons/`, or the second
  copy (`custom/admin-tools_2/`) loses its textures.
- **The announcement overlay renders for every player**, outside the admin gate;
  the panel itself is inside it. `admin.tsx`'s `render()` mounts
  `<AnnouncementOverlay/>` unconditionally and `this.panel(...)` only for admins.
- **Admin gating** is `signedFetch /scene-admin`, with everyone an admin in local
  preview (Hub precedent — without it the panel is untestable offline).
- **`ReactEcsRenderer.setUiRenderer` is single-owner per scene.** `ui-owner.ts`
  is first-wins plus a console warning; a scene with two UI-owning scripts loses
  one of them.
- **Endpoints are hardcoded** (`comms-gatekeeper.decentraland.<org|zone>`,
  `rewards.decentraland.<org|zone>`) exactly as they are in the Hub runtime, with
  the org/zone switch driven by the realm's network id.
- **Not ported:** the DCL Cast presentation-bot flow (this SDK pin exposes only
  `getActiveVideoStreams` from `~system/CommsApi` — no pub/sub transport) and the
  rewards supply counter (the server rejects the explorer's signedFetch for it).
- **`asset-packs::AdminTools` is deliberately absent from `ALLOWED_COMPONENTS`,**
  so it stays out of the Add-Component picker: the config with no `admin.tsx`
  behind it would do nothing. The inspector still renders it for placed prefabs.
- `packages/desktop/prefabs/tsconfig.json` type-checks the prefab scripts against
  `@dcl/sdk` as part of the desktop workspace `typecheck`, so drift is caught here
  rather than in a creator's project.
