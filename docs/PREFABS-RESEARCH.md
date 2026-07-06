# Prefabs (entities + scripts) — research & design

Goal: reusable **combinations of entities + scripts** ("prefabs"), modeled on the
Creator Hub's Script component + custom assets — but **without** the smart-items
(Actions/Triggers/States) framework. This doc is the research findings on how the
Creator Hub does it and a design for bringing it here.

> **Source note:** the Script component/inspector sources referenced below live in
> the **`@dcl/inspector` npm package** (installed in this repo's `node_modules`),
> not in a `../creator-hub` sibling checkout. The npm dist ships only `.d.ts`
> declarations + a webpack bundle — the parser/template implementations were
> recovered from `public/bundle.js.map` (`sourcesContent`) and ported into
> `packages/ui/src/script/`.

---

## 0. Revalidation & implementation status (2026-07-05)

Every load-bearing claim was re-verified against the installed toolchain
(`@dcl/sdk-commands` + `@dcl/inspector` @ `7.22.6-…commit-83012ab`), and **Phase 2
(script authoring) is now implemented** on branch `feat/script-component`.

Verified true:
- `dist/logic/runtime-script.js`, `bundle.js`, `composite.js`,
  `script-module.d.ts.template` all present in the **installed** sdk-commands.
- `composite.js → getAllComposites` collects `EditorComponentNames.Script`
  (= **`asset-packs::Script`**) off every composite entity;
  `bundle.js → generateInitializeScriptsModule` codegens `~sdk/script-utils`;
  `runScripts` instantiates `new ScriptClass(src, entity, ...params)` (params in
  `Object.values(layout.params)` order), calls `start()`, and registers a
  per-priority `update(dt)` system. Functional scripts (`export function start`)
  are supported too.
- **End-to-end spike passed**: a hand-authored `main.composite` carrying
  `asset-packs::Script` (+ `assets/scene/Scripts/spinner.ts`) in a minimal scene
  builds with our exact sdk-commands — the class and `_initializeScripts` land in
  `bin/index.js` and the type checker passes.
- This editor already defines `asset-packs::Script` in
  `packages/scene/src/custom-registry.ts` and custom (engine-opaque) components
  already round-trip: CRDT via `/set_component_raw` → snapshot decode → save-diff
  → `main.composite` (`isSavableComponent` is true for custom components).

Corrections to the claims below:
- **`layout` is a JSON *string*** (`Schemas.Optional(Schemas.String)`), not an
  object: `JSON.stringify({ params, actions, error })`. The runtime `JSON.parse`s it.
- **The inspector's parser/templates are *not* importable** from the installed
  `@dcl/inspector` (only type declarations ship). They are now **ported** to
  `packages/ui/src/script/parser.ts` (`@babel/parser`-based, behavior-identical)
  and `template.ts` (Hub-verbatim class template; scripts live under
  **`src/scripts/`** here — Hub scripts under `assets/scene/Scripts/` still load,
  the component stores full paths).
- The inlined script runtime **always** bundles `@dcl/asset-packs` (top-level
  `require`, not just for `ActionCallback`) — but sdk-commands provides an esbuild
  **alias** with fallback resolution (project → nested under `@dcl/inspector` →
  sdk-commands' own tree), so **projects need no extra dependency**; the scene
  bundle just grows when ≥1 script exists.
- Side effect worth knowing: every scripts-build **rewrites the project's**
  `node_modules/@dcl/js-runtime/sdk.d.ts` with a `~sdk/script-utils` declaration
  that `import()`s each script by absolute path.

What was implemented (Phase 2, authoring):
- `asset-packs::Script` added to the Add-Component picker
  (`packages/scene/src/allowed-components.ts`, `SCRIPT_COMPONENT`).
- A bespoke Script inspector view (`packages/ui/src/panels/views/script-view.tsx`):
  per-script priority + typed param fields (number / string / boolean / entity;
  `action` shown as unsupported), re-parse-from-file with value-preserving
  `mergeLayout`, add-script (scaffold from template or attach existing file).
- **In-app code editing**: a CodeMirror 6 modal reads/writes the script file over
  the dev server's data-layer RPC (`getFile` added to `packages/ui/src/datalayer.ts`);
  saving re-parses the constructor and refreshes the param UI. The desktop shell
  already starts the project server with `--data-layer`, so this works in Electron
  out of the box.

Proven end-to-end in the running Electron app (CDP probes in
`packages/desktop/validate/probe-script-*.mjs`, run with `BEVY_EDITOR_PROJECT`
pointing at a scene):
- **Runtime** (`probe-script-runtime.mjs`): a composite-authored script
  instantiates with its layout param values (`speed: 45` observed) and, after
  pressing Play, `update(dt)` visibly rotates the entity in the live CRDT.
  (Scripts only tick in play mode — the edited scene is frozen while editing.)
- **Authoring** (`probe-script-authoring.mjs`): select entity → add
  `asset-packs::Script` from the picker → name a script → template file written
  to `assets/scene/Scripts/<name>.ts` over the data-layer → the CodeMirror modal
  opens on the scaffolded class → component value + file + `main.composite`
  round-trip all verified.

Gotcha for future data-layer work: the dev server registers most `DataService`
procedures with **PascalCase wire names** (`GetFile`, `GetAssetData`, …) but a
few legacy ones lowercase (`saveFile`, `getFiles`) — match the wire name, not
the ts-proto method key, when hand-rolling clients (`packages/ui/src/datalayer.ts`).

Still open (Phase 1 / prefabs): the prefab format, create-from-selection,
instantiate-at-drop, and bundling a script's `.ts` tree into a prefab (§4/§5).

---

## 1. How the Creator Hub *Script component* works

A script is a **TypeScript class**, scaffolded from a template
(`inspector/.../ScriptInspector/templates.ts`):

```ts
export class MyScript {
  constructor(
    public src: string,    // DO NOT REMOVE  (internal ref)
    public entity: Entity, // DO NOT REMOVE
    // custom inputs below — these become the UI fields:
    // public speed: number, public target: Entity, ...
  ) {}
  start() { /* once */ }
  update(dt: number) { /* per frame */ }
}
```

- **Constructor params after `src`/`entity` are the inputs.** Supported types:
  `Entity`, `String`, `Number`, `Boolean`, `ActionCallback`.
- **The Inspector parses the class** (`ScriptInspector/parser.ts → getScriptParams(content)`)
  into a `layout = { params, actions, error }`, and renders one typed field per
  param (`ScriptParamField`). A refresh button re-parses after you edit the file.
- **Stored on the entity** as a `Script` SDK component (`ComponentName.SCRIPT` =
  `asset-packs::Script`), whose value is an **array** (multiple scripts per
  entity): `{ value: [{ path, priority, layout }] }` where `layout` is a **JSON
  string** of `{ params: {name:{type,value,optional?}}, actions, error? }`.
- **Authoring file lives in the project**: `assets/<pack>/scripts/<name>.ts`.
- **Runtime is scene-side.** The script files are bundled into the scene; a
  generated `~sdk/script-utils` registry + the **asset-packs system scene**
  instantiate each Script-bearing entity's class with the stored param values and
  drive `start()` once + `update(dt)` per frame. `CALL_SCRIPT_METHOD` (an Action)
  and `ActionCallback` params bridge the no-code Actions/Triggers system to scripts.

> **Entanglement:** the Script *runtime* is part of the asset-packs framework
> (the smart-items system scene runs it, and it interops with Actions/Triggers/
> States). That framework is exactly what we want to leave out — so we keep the
> *ergonomics* (a typed class + param UI + a component on the entity) and build our
> own minimal runner.

---

## 2. How *custom assets* (prefabs) work

`inspector/.../operations/create-custom-asset/index.ts`:

1. **Select entities** → `getComponentEntityTree` walks the subtree.
2. **Collect components**, excluding editor-only ones (`Selection`, `Nodes`,
   `TransformConfig`, `Hide`, `Lock`, `Ground`, `Tile`, `CustomAsset`,
   `NETWORK_ENTITY`).
3. **Collect + relocate resources** (gltf, textures, **and script files**): each
   resource path is pushed into `resources`, and the component value is rewritten
   to a templated path — e.g. a Script's `path` becomes `{assetPath}/scripts/main.ts`.
4. **Result = `AssetData`**: a serialized entity subtree + its components (Script
   included, with templated paths) + the bundled resource files.

Dropping the prefab from the catalog re-instantiates the subtree: new entity ids,
parent refs remapped, `{assetPath}` resolved to the new location. **So a prefab is
self-contained and relocatable, and its scripts travel with it.**

---

## 3. What this editor has / lacks

| Capability | dcl-editor today |
|---|---|
| Entity/component snapshot (CRDT) | ✅ `state.snapshot`, `crdt_snapshot` |
| Component writes + composite save | ✅ `set_component`, save-diff |
| Asset catalog + place/import | ✅ `AssetsPanel` (catalog, local models, drop at camera) |
| Entity-tree walk / reparent | ✅ `parentOf`, `topLevelSelected`, reparent ops |
| **Script component** | ❌ none |
| **Custom asset / prefab** | ❌ none |
| **Script runtime** | ❌ none |

We already have the hard parts for the *entities* half (snapshot, tree, write,
save, catalog, camera-drop). The new work is the prefab format + the script layer.

---

## 4. Design — prefabs for dcl-editor (no smart-items)

Three layers, built so the first is useful alone.

### Layer A — Prefab = a reusable entity+component group (no runtime needed)
- **Format** (`assets/prefabs/<name>/prefab.json` + bundled resources), modeled on
  `AssetData` but minimal:
  ```jsonc
  { "name": "Door", "root": "0",
    "entities": [{ "id": "0", "parent": null, "components": { "Transform": {…}, "GltfContainer": { "src": "{prefab}/door.glb" } } }],
    "resources": ["door.glb"] }
  ```
- **Create from selection** — reuse what we have: walk the selected subtree
  (`topLevelSelected`/`parentOf` over `state.snapshot`), copy each entity's
  components minus editor-only ones, copy referenced resource files into the
  prefab folder, rewrite paths to `{prefab}/…`. (Mirrors `create-custom-asset`.)
- **Instantiate** — drop → allocate fresh entity ids, recreate components via the
  existing write path (`new_entity`/`set_component`), remap parent refs + resolve
  `{prefab}`, place the root at the camera-drop point (we already compute it:
  `cameraDropLocal`).
- **UI** — a **Prefabs** section in `AssetsPanel` (next to Catalog / Local), and a
  **"Save as prefab"** action on the current selection (toolbar `⋯` / hierarchy
  context menu).

This layer alone delivers "reusable combinations of entities" and reuses the
editor's snapshot/save/catalog/drop plumbing — **no script runtime required.**

### Layer B — Scripts: **the runtime already ships in our toolchain**
The big correction (verified): we do **not** build a script runtime. It's in
`@dcl/sdk-commands` — the exact bundler this editor builds scenes with — and our
installed version (`7.22.6-…commit-83012ab`) already has it:
`dist/logic/runtime-script.js`, `bundle.js`, `composite.js`,
`script-module.d.ts.template`. The pipeline:

1. The `Script` is an **`@dcl/inspector` editor component stored in the composite**
   (`EditorComponentNames.Script`, value `[{ path, priority, layout }]`).
2. At build, `composite.ts → getAllComposites` reads `Script` off every entity →
   `scripts: Map<path, Script[]>`.
3. `bundle.ts → generateInitializeScriptsModule` codegens a virtual
   `~sdk/script-utils` that imports each script file + embeds `runtime-script.ts`,
   and the SDK entrypoint calls `_initializeScripts(engine)`.
4. `runScripts` instantiates each script (**class** — `new Script(src, entity,
   ...params)` — *or* functional), runs `start()`, and adds a per-priority
   `update(dt)` system. `callScriptMethod`/`getScriptInstance` expose them.

Because this editor already (a) reads/writes the **composite** and (b) builds with
**sdk-commands**, scripts run for free once the composite carries a `Script`
component and the `.ts` files exist. Pure custom scripts don't need the smart-items
framework (asset-packs is only pulled in for the optional `ActionCallback` bridge).

So our work for scripts is **authoring only**:
- **Recognize the `Script` editor component** (match `@dcl/inspector`'s name +
  schema) so it round-trips through our composite save and sdk-commands picks it up.
- **A ScriptInspector-like panel**: scaffold a script file from the class template,
  parse its constructor → `layout.params` (the inspector's parser/templates are
  **not importable** from the installed `@dcl/inspector` — ported into
  `packages/ui/src/script/`, see §0), edit param values.
- **Prefab-with-script** falls out of Layer A: the bundler already packages
  arbitrary components + resources, so an entity with a `Script` component + its
  `.ts` file bundles + re-instantiates like any other prefab.

### Layer C — UI is free, too
A script that draws UI (e.g. an admin panel) is **not** a special case: a scene can
register multiple UIs — `addUiRenderer`, or one `setUiRenderer` whose
`UiComponent` (`() => ReactEcs.JSX.ReactNode`) returns an array, or several
`createReactBasedUiSystem(engine, …)` instances. So multiple UI prefabs compose on
one canvas with no shared-root coordination to build.

---

## 4b. Case study — replacing the Admin smart item with a prefab

The real target: drop a complex smart item like **Admin Tools** and rebuild it as
*your own* prefab. This is feasible because the Admin item has **no magic** — it's
~5,200 LOC of ordinary SDK7 (`asset-packs/admin-toolkit-ui/`):

- a **React-ECS UI** (`import ReactEcs … from '@dcl/react-ecs'`) — the admin panel,
  moderation/ban list, video & livestream control, announcements, rewards;
- plain **components/systems/fetch** (`@dcl/ecs`, scene-admin/ban REST APIs);
- mounted via a **`ReactBasedUiSystem`** it's handed
  (`createAdminToolkitUi(engine, reactBasedUiSystem, helpers)`). Note the asset-packs
  scene *chooses* to create one `createReactBasedUiSystem(engine, …)` in
  `scene-entrypoint.ts` and pass it around — but that's a choice, not a limit.

The **Script component is exactly the hook for this**: it attaches a TS class
(`start()`/`update(dt)`) to an entity, and that class has **full SDK7 access** —
it can `import '@dcl/sdk/ecs'` and `'@dcl/react-ecs'`, mount UI, add systems,
read/write components, `fetch`, sign requests, etc. So in `start()` a script can do
**everything the Admin item does**. A script's `path` points to one `.ts` file, but
that file can import a whole module tree — i.e. your own `admin-toolkit-ui/`.

**Therefore a prefab = entity + a `Script` component + the bundled code tree (+ its
icons/assets).** Dropping it gives a self-contained admin panel that is *your code*
(no Actions/Triggers DSL, no asset-packs framework) — which is exactly the goal.

What we actually have to provide is small (the runtime is the toolchain's — §4 B/C):
- **Runner: nothing.** `sdk-commands` (`runtime-script.ts`) instantiates the
  script class and drives `start()`/`update(dt)` at build/run time — already in our
  installed toolchain.
- **UI: nothing special.** Multiple renderers compose (`addUiRenderer` / a
  `ReactNode`-array `setUiRenderer` / multiple `createReactBasedUiSystem`), so the
  admin panel's UI coexists with everything else with no shared-root to build.
- **Authoring**: recognize the `Script` editor component + a ScriptInspector-like
  panel (scaffold the class, parse constructor → params, edit values).
- **Prefab bundling of code**: package the entity + `Script` component + every
  `.ts/.tsx` it imports + assets, with templated paths (extending
  `create-custom-asset`'s single-file handling to a folder).

So "Admin as your own prefab" is a bundling + authoring task on top of an existing
runtime — not a runtime rebuild. The Admin item proves the model: complex behavior
as attached, bundled code already runs through this exact pipeline.

## 5. Recommendation

The runtime is solved by the toolchain, so the work is **authoring + bundling** —
no engine/runtime build. Two phases:

**Phase 1 — Prefabs (Layer A).** Reusable entity+component groups: create-from-
selection, instantiate-at-camera-drop, a Prefabs section in the AssetsPanel. Reuses
everything we have (snapshot, tree walk, writes, save, catalog, drop). No scripts yet.

**Phase 2 — Scripts (Layers B/C), authoring only.** (1) Recognize the `@dcl/inspector`
`Script` editor component so it round-trips in our composite save and sdk-commands
runs it; (2) a ScriptInspector-like panel (scaffold class, parse params, edit values),
reusing the installed `@dcl/inspector` parser/templates; (3) extend the Phase-1
bundler to package a script's `.ts/.tsx` files + assets. Prefabs then carry scripts —
e.g. **Admin-as-your-own-prefab**.

**Verify-first checklist (small spikes before committing):**
- Confirm a hand-authored `Script` editor component in a `main.composite` + a script
  `.ts` file actually runs when the scene is built/started with our `sdk-commands`
  (it should — `runtime-script.js` is installed). This validates the whole premise.
- Confirm our composite round-trip (save-diff) preserves the `Script` component
  unchanged (it's just another component value).

Recommendation: **Phase 1 first** (prove the prefab format + instantiate loop), and
in parallel run the Phase-2 spike above (author a Script by hand, confirm it runs)
so Phase 2 is de-risked before we build its UI.
