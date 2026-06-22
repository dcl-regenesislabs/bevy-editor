# Scene UI — visualization & creation (research)

Goal: improve how scene **UI** (the React-ECS 2D/HUD layer) is **visualized** and
**created**. We already built a visualizer (`sdk-commands ui-preview`, branch
`feat/ui-preview-command` in `../js-sdk-toolchain`); this assesses it and designs
the missing **creation** half.

---

## 1. What we have — `ui-preview` (visualization)

`sdk-commands ui-preview` renders a scene's React-ECS UI **in the browser with
hot-reload, without launching the 3D client**. How it works:

- **Shared engine projection** (`harness/renderer.ts`): it drives the *same*
  engine the scene's `ReactEcsRenderer.setUiRenderer(...)` targets, then **reads the
  UI tree out as plain data** — `UiNode[]` of `UiTransform` + `UiText` /
  `UiBackground` / `UiInput` / `UiDropdown` / `PointerEvents`, ordered via the
  `rightOf` sibling linked-list.
- **DOM rendering** (`harness/dom.ts`): maps each `UiTransform` → **CSS flexbox**
  (the browser's flex engine lays it out — "visually ~faithful", Yoga-exact parity
  noted as a later upgrade). Click is synthesized back into `PointerEventsResult`
  so the scene's handlers fire.
- **Panels** — a `ui-preview.tsx` whose default-exported named functions seed game
  state; each becomes a sidebar entry (flip through every screen without playing
  to reach it). Switching panels reloads (clean state).
- **Stories** — `*.stories.tsx` named exports render a component in isolation
  (storybook-style), live-swapped via `setUiRenderer`.
- **Canvas presets** (iPhone / device DPR, `--mobile`), hot-reload, scaffolding
  hints.

**It is view-only.** There's no node selection, no property editing, no
drag/drop, no code generation — you author UI by hand-writing React-ECS `.tsx`;
the preview only *shows* it. That's the gap.

---

## 2. The creation gap — and the core tension

The thing that makes "creation" non-trivial: **React-ECS UI is *code*, not data.**
The `UiNode[]` tree the harness reads is the *output* of render functions that can
contain state, props, loops, and conditionals. So:

- You **cannot** generically round-trip "edit the live tree → regenerate the
  source" — the source isn't a static tree.
- A visual builder therefore needs to own a **design model** (a serializable UI
  spec) and **emit** React-ECS code from it; the dynamic wiring (data, handlers,
  conditionals) is then added in code. The designer authors *layout + static
  structure*; code supplies *behavior*.

This is the same split every UI builder lives with (Webflow/Figma-to-code): the
tool owns the static layout; developers own the dynamic parts.

---

## 3. Decision — a layout playground that generates `.tsx`

After working through the alternatives, the chosen creation model is a **visual
layout playground**: drop boxes, arrange the flex layout, and **generate React-ECS
`.tsx`**. The **`.tsx` is the artifact** (you own it); the playground exists to kill
the flexbox/`uiTransform` boilerplate, not to be a runtime.

**Scope — what it does and doesn't:**
- **Does:** lay out a *component's static structure* visually — containers/text/
  buttons/images, flex props, sizing, spacing, colors, nine-slice/atlas — and emit
  a clean React-ECS component.
- **Doesn't:** own control flow or state. Conditionals (open/close panels, screen
  switching), dynamic data, Storage, handlers → **hand-coded** in (or around) the
  generated file. The playground produces a **component**; your code composes and
  gates components, where logic belongs.
- **One-way generate** (not two-way sync): you generate `.tsx`, then it's code you
  edit. (A hand-edited `.tsx` doesn't round-trip back into the playground — that's
  the JSX-AST problem we deliberately avoid.) The playground may persist its own
  layout (a small project file) so *it* can re-open, but the scene consumes `.tsx`.

**Rejected alternatives (and why):**
- *JSON spec + a runtime interpreter*: clean round-trip, but it becomes a weak
  programming language the moment UI needs conditionals/state/Storage, locks UI into
  editor-only authoring, and adds an interpreter + bindings + `ctx` for diminishing
  returns. Real UI is highly conditional → that machinery fights you.
- *Visual editor over the live `.tsx` AST (two-way)*: most powerful but the JSX
  parse/print + partial-editability is the hardest build; not worth it for v1.

**Reuses the `ui-preview` renderer.** The `UiTransform → CSS flexbox` mapping
(`dom.ts`), nine-slice (`border-image`), and atlas (`applyUvsAtlas`) already exist —
that *is* the playground canvas. New parts: selection + drag/flex gestures, the
inspector, a palette, and a **tree → React-ECS `.tsx` emitter**.

### Direct manipulation → flex (the craft)
| Gesture | Emits |
|---|---|
| Drag between siblings | reorder (child order) — insertion line |
| Drag into a container | reparent |
| Drag toward edges/center | parent `justifyContent`/`alignItems` (3×3 snap) |
| Arrow keys (in flow) | `margin{Top/…}` nudge (Shift = 10px) |
| ⌘-drag / Absolute toggle | `positionType: absolute` + `top`/`left` |
| Resize handles | `width`/`height` (+ px/% unit) |

### Generated output (example)
```tsx
export function MyPanel() {
  return (
    <UiEntity uiTransform={{ width: 320, flexDirection: 'column', alignItems: 'center', padding: 16 }}
      uiBackground={{ color: Color4.create(0.1, 0.1, 0.12, 0.9) }}>
      <Label value="Title" fontSize={18} />
      <UiEntity uiTransform={{ width: 120, height: 40, margin: { top: 12 } }}
        uiBackground={{ texture: { src: 'images/btn.png' }, textureMode: 'nine-slices',
                        textureSlices: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } }}>
        <Label value="Play" />
      </UiEntity>
    </UiEntity>
  )
}
```
You then wire behavior in code: `{open && <MyPanel/>}`, `onMouseDown={onPlay}`, etc.

---

## 4. Where it lives + build plan

**Home:** a **UI Playground** surface in the dcl-editor Electron app (a mode/tab in
the React host), reusing the ported `ui-preview` renderer for the canvas and the
desktop shell's file access to write the generated `.tsx` into the scene. (`ui-preview`
remains the *visualization* core — run/see the real, composed, dynamic UI with
hot-reload.)

**Phase 1 (MVP) — built** (`packages/ui/src/uiBuilder/`): the data tree + immutable
reactive store (`model.ts`), the canvas projecting `UiNode → CSS flexbox` with select
+ HTML5 drag-to-reorder/reparent (`render.tsx`), a design-system palette / layer tree /
property inspector (`panels.tsx`), a Scene⇄UI mode switch in the toolbar, and a
**tree → React-ECS `.tsx` emitter** (`codegen.ts`, unit-tested) surfaced via a
**Generate `.tsx`** modal (copy to clipboard — the shell has no file-write API).
Covers all four node kinds (container/text/button/image), colors, nine-slice +
atlas UVs, and **prop binding** (mark a field → typed `props` component). Image
authoring is wired: import from disk (`images/`) or pick an existing project image,
with live preview via the content server.

**Direct manipulation — built** (`render.tsx`): pointer-drag moves an element
(→ `positionType:'absolute'` + `position`), 8 resize handles drive `width`/`height`,
arrow keys nudge (Shift = 10px), drop-over-a-container reparents (returns to flow),
and Delete removes the selected element. Hierarchy reordering is on the Layers panel.

**Import an existing `.tsx` — built** (run-and-read, per §3): the desktop main
process esbuild-bundles the chosen file with a tiny inlined demo-mode renderer
(`@dcl/sdk/*` + `@dcl/ecs`/`@dcl/react-ecs` aliased to the project's copies, `~system/*`
stubbed — mirrors `sdk-commands ui-preview`); the renderer runs that IIFE in a hidden
blob iframe, which renders the component against a throwaway engine and posts the
read-out `UiNode[]` tree back; `convert.ts` (unit-tested) decodes it into the builder
model. Static snapshot — handlers/conditionals aren't recovered. Files:
`desktop/src/main.ts` (`bundleUiImport`/`listUiFiles`), `uiBuilder/importTsx.ts`,
`uiBuilder/convert.ts`.

**Phase 2 (remaining polish):** flex-gesture craft (align-snap zones, ⌘-drag toggle),
a visual **nine-slice guide editor** and **atlas rect picker** (today both are numeric
inputs), Input/Dropdown node kinds, a snippet palette to seed common layouts. Generated
`.tsx` is copy-to-clipboard until the desktop shell gains a scoped write-file API.

**Pairing with visualization:** generate in the playground → the scene imports the
component → `sdk-commands` hot-reloads → the bevy viewport (and `ui-preview`) show it
live, composed with your hand-written control flow.
