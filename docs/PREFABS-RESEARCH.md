# Prefabs (entities + scripts) — research & design

Goal: reusable **combinations of entities + scripts** ("prefabs"), modeled on the
Creator Hub's Script component + custom assets — but **without** the smart-items
(Actions/Triggers/States) framework. This doc is the research findings on how the
Creator Hub does it (`../creator-hub`) and a design for bringing it here.

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
- **Stored on the entity** as a `Script` SDK component (`ComponentName.SCRIPT`),
  whose value is an **array** (multiple scripts per entity):
  `{ value: [{ path, priority, layout: { params: {name:{type,value}}, actions } }] }`.
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
  parse its constructor → `layout.params` (the inspector's parser/templates are in
  the installed `@dcl/inspector`, reusable), edit param values.
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
