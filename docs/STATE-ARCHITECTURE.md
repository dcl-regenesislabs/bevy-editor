# State & reactivity

How the editor's React UI stays in sync with `state`. Read this before touching
`store.ts`, `reactive.ts`, `state.ts`, or adding reactive reads/writes in a panel.

> **TL;DR**
> - **Write:** `state.x = y`. The store auto-notifies — no `bump()`, no tick.
> - **Read (in a component):** `const x = useStore(() => state.x)`. The component
>   re-renders **only** when that slice changes (`Object.is`). Fine-grained.
> - **Collections & the snapshot:** never mutate in place. Go through the
>   replace-on-write helpers in `state.ts` (`setSelected`, `setFieldEdit`,
>   `setSnapshotComponent`, …). A bare `state.selected.add(x)` will **not** re-render.

---

## The pieces

| File | Role |
|---|---|
| `packages/scene/src/reactive.ts` | The reactive core: `reactive()` (the auto-notifying `Proxy`) + `subscribe()`. **React-free**, so it's safe in the SDK7 scene bundle. |
| `packages/ui/src/store.ts` | The React binding: `useStore(selector)` over `useSyncExternalStore`. Re-exports `reactive`. |
| `packages/scene/src/state.ts` | `export const state = reactive({...})` + the **replace-on-write helpers**. |

`state` is **one object, bundled into both the React UI and the SDK7 scene**.
That dual life dictates everything below.

---

## Writing state

```ts
state.activeAction = 'translate'   // top-level assignment → auto-notifies ✅
state.frozen = true                // ✅
state.scene = msg.scene            // ✅
```

The `Proxy` traps `set`/`deleteProperty` and notifies subscribers. You do **not**
call anything afterward. There is no `bump()` and no `setInterval` safety tick —
they were removed; don't reintroduce them.

### …except Sets, Maps, and the nested snapshot

The proxy is **shallow** — it sees `state.x = …`, but **not**:
- a `Set`/`Map` mutated in place: `state.selected.add(id)`, `state.drafts.set(k, v)`
- a nested snapshot write: `state.snapshot[id][name] = v`, `delete state.snapshot[id]`

Those don't assign a tracked top-level property, so **they don't re-render.**
Every such write goes through a **replace-on-write helper** in `state.ts`, which
builds a fresh copy and reassigns the top-level field (that assignment is what
notifies):

| Instead of… | Call |
|---|---|
| `state.selected.add/delete/clear` | `setSelected(ids)`, `selectionClick(...)`, `clearSelection()`, `applyBoxSelection(...)` |
| `state.expandedEntities.add/delete` | `toggleEntity(id)`, `expandEntity(id)`, `selectEntityInTree(...)` |
| `state.expandedComponents.add/delete` | `toggleComponent(key)`, `setComponentExpanded(key, bool)` |
| `state.drafts.set/delete` | `setDraft(k, t)`, `revertDraft(k)`, `clearComponentEdits(k)` |
| `state.fieldEdits.set/delete` | `setFieldEdit(k, v)`, `deleteFieldEdit(k)`, `deleteFieldEditsWhere(pred)` |
| `state.editStatus.set/delete` | `setEditStatus(k, msg)`, `clearEditStatus(k)` |
| `state.schemas.set` | `setSchema(name, schema)` |
| `state.snapshot[id][name] = v` | `setSnapshotComponent(id, name, v)` |
| `delete state.snapshot[id][name]` | `deleteSnapshotComponent(id, name)` |
| `delete state.snapshot[id]` | `deleteSnapshotEntity(id)` |

**Adding a new collection or nested field to `state`?** Add a helper next to these
and use it everywhere — never mutate the collection in place from a call site.

> Collections that are **only used by scene logic and never read in a component's
> render** (`editedComponents`, `deletedComponents`, `deletedEntities`,
> `editorValues`, `schemaPending`, `fieldRev`) are still mutated in place on
> purpose — they don't need to re-render anything, so a copy-on-write would be
> pure overhead. If you start rendering one of them, give it a helper first.

---

## Reading state in a component

```tsx
import { useStore } from '../store'
import { state } from '../../../scene/src/state'

function Toolbar() {
  const activeAction = useStore(() => state.activeAction)   // one slice
  const frozen = useStore(() => state.frozen)               // another slice
  return <button className={activeAction === 'select' ? 'active' : ''} … />
}
```

`useStore(selector)` re-renders the component **only when `selector()`'s value
changes** (`Object.is`). A change to `state.selected` won't re-render a component
that only selects `state.assetCatalog`. This is the whole point — fine-grained,
no "everything re-renders."

### Two rules for selectors

1. **Return a stable value** — a raw slice or a primitive. **Never** return a
   freshly-built object/array, or it changes every call (`Object.is` always
   false) and the component re-renders forever:
   ```ts
   const items = useStore(() => state.assetCatalog)              // ✅ raw slice
   const visible = items.filter(matchesFilter)                   // derive in render
   // const visible = useStore(() => state.assetCatalog.filter(…)) // ❌ new array every call
   ```
2. **One `useStore` per slice.** Need three fields? Call it three times. (Cheap —
   each is just an `Object.is` check.) Don't pack them into one object selector.

A boolean/derived **scalar** selector is fine and even tighter, because the value
is stable when unchanged:
```ts
const isSelected = useStore(() => state.selected.has(id))   // ✅ re-renders only when THIS row's membership flips
```

### Reads through helper functions

Some values are read via plain functions that touch the raw `state`
(`getDraft`, `getSchema`, `currentString`, …). Wrap the **helper call** in the
selector so the subscription tracks the slice it reads:
```ts
const schema = useStore(() => getSchema(name))   // re-renders when state.schemas gains `name`
const draft  = useStore(() => getDraft(key, value))
```

### Reads outside render (handlers, effects)

In an `onClick`, `useEffect`, or any callback, read the **live `state`** directly
— you want the current value, not a render-time selection:
```ts
useEffect(() => { if (state.assetCatalog.length === 0) void uiFetchCatalog() }, [])
onClick={() => uiSetCamera(state.camMode === 'none' ? 'free' : 'off')}
```

---

## Why hand-rolled instead of zustand / valtio?

Because **`state.ts` is bundled into the SDK7 scene**, which runs in a
stripped-down V8 sandbox (`dcl_deno`) with **no browser globals** (no `window`,
`navigator`, `document`, `process.env`).

- valtio's **core** (`proxy`) works there — it uses only `Proxy`/`Reflect`.
- valtio's **`proxySet`/`proxyMap`** (from `valtio/utils`) **crash the scene at
  init** with `Cannot read properties of undefined (reading 'bind')` — the utils
  barrel assumes a browser (its `devtools` reaches for `window`, and its typings
  reference the DOM `Window`). The scene never reaches `scene-ready`, so the editor
  hangs at boot. (Confirmed: plain `proxy()` → e2e 10/10; add `proxySet`/`proxyMap`
  → boot timeout.)

We only needed `proxy` + `subscribe` + selectors anyway (the codebase reads state
through helpers, which valtio's `useSnapshot` auto-tracking can't follow). That's
~30 lines we own outright — and it can't pull a browser-only dependency into the
scene by accident. See `reactive.ts` / `store.ts` for the full source.

---

## Two runtimes, one shape

`state` is the **same code** in two places, but **separate instances at runtime**:

- **UI bundle (browser):** `reactive()` notifies; `useStore` subscribers re-render.
- **Scene bundle (engine sandbox):** also a `reactive()` proxy, but **no
  subscribers** (no React there), so `notify()` is inert. The scene mutates its
  own `state` for gizmos/selection and syncs to the UI over the **editor bus**
  (`scene-ready`, `selection`, … in `boot.ts handleSceneMessage`) — not through
  this store. Don't expect a scene-side write to re-render the UI directly; it
  arrives as a bus message that the UI applies to *its* `state`.

---

## Checklist when you touch this

- [ ] Writing a `Set`/`Map`/snapshot field? Use (or add) a replace-on-write helper — never `.add/.set/.delete` in place.
- [ ] Reading in render? `useStore(() => state.x)`, one per slice, selector returns a stable raw value.
- [ ] Reading in a handler/effect? Use the live `state` directly.
- [ ] Don't add `bump()` or a polling tick. Writes notify themselves.
- [ ] Don't import anything browser-only into `reactive.ts`/`state.ts` (it ships in the scene).
- [ ] `npm run validate` green, and `npm run validate:e2e` 10/10 if behavior changed.
