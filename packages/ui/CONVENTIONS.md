# packages/ui conventions

## File naming (enforced by the `local/filename-convention` eslint rule)
There is ONE rule, and it is a biconditional so nobody has to guess:
- `.ts` — no JSX. Logic, stores, helpers, types. **kebab-case** (`chat-helpers.ts`,
  `prefab-store.ts`). Never camelCase, never snake_case.
- `.tsx` — React. **PascalCase if and only if the file exports the component it is
  named after** (`Composer.tsx` exports `Composer`). A collection with no single
  headline component — an icon set, a view registry, a family of small editors —
  stays **kebab-case** (`icons.tsx`, `transcript.tsx`, `panels/views/*`).
- A barrel is `<folder>/index.ts`, never a `<folder>.ts` sibling next to
  `<folder>/` (`ds/index.tsx`, `bevy-api/index.ts`, `inspector/index.ts`).
- `.css` is named after the feature or component that owns it.

## Where code goes
- `src/ds/` — design-system primitives. One `<Name>.tsx` + sibling `<Name>.css` per component.
- `src/features/<domain>/` — screens/features (home, editor, worlds, publish, account, ai).
  PascalCase components; one css file per feature (split per component when it grows).
  No feature barrels; import features by full path.
- `src/panels/` — the docked editor workspace (Hierarchy, Inspector, Assets, Toolbar,
  Dialogs, `views/`): everything that reads/writes scene CRDT state. `features/` is the
  chrome around it (screens, modals, top bar). Non-component panel logic (hierarchy-model,
  reveal, authored-ids…) lives here too, as plain tested `.ts` modules.
- `src/prefabs/`, `src/script/`, `src/ai/` — domain logic (formats, parsers, request
  builders) for their feature surface: pure `.ts` modules with co-located tests; the
  React consumers live in panels/ or features/.
- `src/engine/` — the engine bridge: the bus, console commands, the data layer, the
  engine iframe host, and the `*-web.ts` shims. Knows nothing about the editor's UI
  or the action layer (eslint enforces both).
- `src/core/` — editor state below the commands: store, history, autosave, persist,
  chrome, drag. Actions import core, never the reverse (eslint enforces it).
- `src/actions/` — the single mutation layer, split by domain (selection, entities,
  components, playback, viewport, assets, prefabs). Panels and features call these.
- `src/boot/` — the composition root: boot handshake, launch params, dev HMR. It
  wires everything, so it is the one layer allowed to import in any direction.
- The `src/` root keeps only entries and shared leaves: `App.tsx`, `main-embed.tsx`,
  `ds-showcase.tsx`, `embed.ts`, `icons.tsx`, `log.ts`, `config.ts`, `shortcuts.ts`,
  and the asset/spawn data helpers. Feature data-layers do NOT belong at the root —
  they live in `features/<domain>/`.
- Two back-edges survive this layering (`engine/scene-ui` → core, `core/autosave` →
  panels/features) and are tracked as debt in `docs/REFACTOR-PLAN.md`. Don't add more.
- `engine/*-web.ts` = page-side replacement for the scene module of the same
  basename, swapped in by the `scene-shims` plugin in `vite.config.ts` (which fails the
  build if a key stops matching). Rename them only in lockstep with that map.
- Scene modules are imported ONLY via the `@scene/*` alias (tsconfig + vite + vitest all
  resolve it; eslint bans `../../scene/src` paths). Treat what the ui imports through
  `@scene/*` as the scene package's public API.
- Only boot.ts and the mutation funnels (actions, assets, spawn-points, dev-hmr,
  bevy-api-web) may import `bus.ts` — enforced by eslint. Panels and features go
  through actions.
- `src/test/` — the render harness only (`render.tsx`, `setup-dom.ts`). Nothing
  ships from here; it exists so a `.test.tsx` can mount a component.
- `src/lib/` — cross-cutting non-UI helpers (formatting, api clients).
  Keyboard modifiers live in `src/lib/keys.ts` — `isMod` (⌘ *or* Ctrl), `isPrimaryMod`
  (only the platform's own, for chords the other modifier already owns), and the
  `MOD`/`ALT`/`SHIFT` glyphs + `keyCombo()` for anything a creator reads. Never
  re-sniff the platform or hardcode `⌘` in a string: on Windows that renders a key
  nobody has.
- `src/main-embed.tsx` — entry only: shadow mount, style injection, URL routing.
  **Never add components here.**

## Styling (shadow-root rules)
- The app renders in a shadow root, so stylesheets can't be `<link>`ed. CSS lives in real
  `.css` files imported with Vite's `?inline` and registered:
  `import css from './X.css?inline'; registerCss('ds/X', 'primitives', css)`.
  Layers: `tokens < base < primitives < features < app`; within a layer, registration
  (import) order wins. The entry injects `collectCss()` once.
- Every color/radius/shadow/z/motion value is a `var(--…)` from `ds/styles/tokens.css`
  (single source, ported from bevy-explorer react-web). Raw px is allowed only for
  layout (gap/width/padding). A new raw hex/rgba in a diff must become a token.
- Class prefixes are ownership: `eui-ds-*` = ds primitives, `eui-<feature>-*` = that
  feature's css file. Never style another file's prefix.
- Portals/overlays must target the shadow `.eui-root`, never `document.body`.
- Dynamic values via inline `style` or element-level custom props, not generated CSS.
- Fonts are the one document-level exception (`@font-face` penetrates the shadow).

## One component per role (STRICT — enforced)
A UI role has exactly **one** implementation. Two components for the same job, a
second popup surface, or a hand-written copy of a primitive's markup is a bug, not
a shortcut. Differences are **props with a fixed set of values** (`density`,
`size`), never a styled clone and never an inline `style` override.

`src/ds/canonical-roles.ts` is the role table; `src/ds/ds-contract.test.ts` enforces
it in `npm test` (and therefore `npm run validate` and CI). The rules:

| | rule |
|---|---|
| R1 | every export from `ds/index.tsx` is registered in `CANONICAL_ROLES` or `UNROLED`; no two roles share a component |
| R2 | no raw `<select>` / `<option>` / `<input type="checkbox">` outside `src/ds/` |
| R3 | only `src/ds/` stylesheets declare `.eui-ds-*` selectors |
| R4 | no markup outside `src/ds/` hand-writes a roled component's class |
| R5 | `.eui-ds-toggle` CSS declares exactly the sizes `TOGGLE_SIZES` can emit |
| R6 | no inline `transform: scale(…)` on a ds primitive |
| R7 | one anchored popup surface — every option list renders in `Popover` |
| R8 | every roled component appears in `ds-showcase.tsx` |

`ALLOWED_LEGACY` in the test is **empty and must stay empty**. It exists only so a
large migration can land in stages; every entry is asserted to still match, so a
stale exemption fails the build and has to be deleted with the fix.

Need a primitive to be a different size or sit differently? Add a prop with a
declared set of values, or pass `className` and style *your own* class. If you
find yourself reaching for `.eui-ds-*` from a feature stylesheet, the primitive is
missing an API — add it there.

## Control metrics (enforced — R9)
Interactive controls come in four sanctioned heights, each a token in `ds/styles/tokens.css`:
`--control-h-lg` (40px — forms/toolbar rows: Select default, SearchField lg) ·
`--control-h-md` (38px — the standalone search pill) ·
`--control-h` (28px — panel rows: Button, TextInput, SearchField sm, Select row) ·
`--control-h-dense` (26px — inspector prop rows: Select compact, NumberField).
A ds control's base or variant rule takes `height: var(--control-h…)`, never a raw px —
`ds-contract.test.ts` R9 fails the build otherwise. Controls sharing a flex row share a
scale: a 28px SearchField next to a 26px Select is a bug, not a style choice. If a row
needs a size a control lacks, add the size/density value to the primitive, then its CSS.

The floating toolbar is the one surface that scales off those metrics rather than using
them raw: `.eui-toolbar` sets `--tb-scale` and every one of its own metrics — padding,
gaps, grip, button box, icon size — is a `calc()` off it, so the bar grows as one piece.
Resize it by moving that number, never by editing a rule; anything new added to the bar
takes its size the same way. Toolbar.tsx drops the knob to 1 inline when the default
centred position wouldn't fit between the docks, so the value in CSS is the ceiling,
not a guarantee.

Panel chrome has one more: `--head-h` (42px) is the height of every title bar —
`.eui-panel-head`, the assistant's `.eui-ai-head`, the Studio's `.eui-studio-head`. They
stack (inspector over assistant in the right dock), so the height is shared rather than
picked per panel; change the token, not the rule.

## Spacing
Gaps come from the `--space-1|2|3|4` scale in `tokens.css`, never a hand-picked px.

**A block owns the space around itself.** The recurring bug this prevents: a notice
with a 2px bottom margin looks right under a grid and sits flush against the next
sticky shelf header. If you are choosing a margin by looking at what happens to be
next to it today, the value is already wrong — put the spacing in the block's own
rule (or use `Notice`, which owns its own), so it travels with the block.

## Components over classes
Before writing markup with a bare `eui-` class, check `ds/index.tsx`. Modals use `Modal`;
menus use `MenuItem`; chips/badges use `Chip`; copy actions use `CopyField`/`copyText`;
destructive actions use `ConfirmButton`; paginated lists use `Pager` + `usePageClamp`;
fetch-on-mount panels use `useLoad` + `PanelState`. Variants via props (`variant`/`size`/
`tone`) — never copy-paste a styled clone.

## Adding a ds primitive
1. `src/ds/<Name>.tsx` + `<Name>.css`, token-driven, `registerCss('ds/<Name>', 'primitives', …)`.
2. Export the component + public types from `src/ds/index.tsx`.
3. Add a story block to the showcase (`ds-showcase.tsx`).
4. Controlled-component pattern: `value` + `onChange(value)`; extend native attrs where
   sensible; the escape hatch is `className`, not style overrides.

## Tests
Two vitest projects run under one `npm test` (`vitest.workspace.ts`):
- **node** (`vitest.config.ts`) — every `.test.ts`. Pure logic, no DOM, and it must
  stay that way: it is the fast project and it runs the whole monorepo.
- **ui-dom** (`packages/ui/vitest.dom.config.ts`) — every `packages/ui/src/**/*.test.tsx`,
  in happy-dom. This is where a component is actually mounted.

A `.test.tsx` mounts through `src/test/render.tsx` (`mount`, then `find`/`all`/
`byText`/`click`/`type`/`settle`) — not a testing library, because the queries a
shadow-root component needs are class- and `aria-label`-based anyway. Two rules
keep these tests from becoming a copy-editing tax: **assert structure, not prose**
(classes, `aria-label`s, counts, tones — a reworded label must not fail a test),
and **mock the action layer**, never the store, so the surface is exercised
against real state.

## State
- Feature stores: module singleton + `useSyncExternalStore` (auth.ts, worlds.ts) or the
  `reactive()`/`useStore` idiom (panels/ai-store.ts). Exported mutator functions, not setters.
- Per-request UI state: `useLoad` from `ds/hooks` — not module singletons.
