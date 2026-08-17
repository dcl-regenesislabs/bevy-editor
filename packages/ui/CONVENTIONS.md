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
  feature's css file. Never style another file's prefix — including the ds classes that
  carry no `-ds-` infix (`eui-btn`, `eui-input`, `eui-num`, `eui-select`, `eui-link`,
  `eui-row`, `eui-modal*`, `eui-shelf*`, `eui-menu-item`, `eui-toast`). To place a
  primitive inside your layout, pass it `className` and style **your own** class
  (R3, R15).
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
| R5b–R5f | same, for `Chip` tones/sizes, `StateBlock` tones, `Spinner` sizes, `Select` densities and `Modal` widths: the CSS declares exactly the set the component API can emit, and nothing more |
| R6 | no inline `transform: scale(…)` on a ds primitive |
| R7 | one anchored popup surface — every option list renders in `Popover` |
| R8 | every roled component appears in `ds-showcase.tsx` (R8b: every demo it declares is rendered) |
| R9 | a control's height **is** a `--control-h*`/`--head-h` token — not a raw px, and not a `calc()` off one. Judged on the **last compound** of the selector, so a context override (`.eui-toolbar .eui-btn.primary`) is in scope too, and over **all** CSS, not just `src/ds/`. A `calc()` that reads only tokens is legal (a rung less a well's own padding); one carrying a `*` or a bare length is not |
| R10 | no unitless number token: a unitless custom property is a multiplier by construction. The one exception is a stacking order, so a unitless token is legal only while every `var()` that reads it is a `z-index` — and while it has a reader at all, because "declared now, multiplied next commit" is the window a knob is born in |
| R11 | no size computed by multiplication. `calc()` **composes** tokens (`top: calc(space + control-h + space)`); it does not scale them |
| R13 | `Spinner`'s size is a declared step, never a number |
| R14 | every `var(--x)` names a property something declares — a missing one with no fallback resolves to `unset` and *inherits*, so the rule silently renders someone else's value |
| R15 | a feature stylesheet never declares a ds-owned selector — `eui-ds-*` **and** the pre-`ds-` half (`eui-btn`, `eui-input`, `eui-num`, `eui-select`, `eui-link`, `eui-row`, `eui-modal*`, `eui-shelf*`, `eui-menu-item`, `eui-toast`). Matched per **rule**, not per line, so half a wrapped selector list cannot slip past |

Two doors are deliberately still open, both staged migrations, and neither may use
`ALLOWED_LEGACY` (a bare path there prefix-matches every hit in the file, so
exempting one sheet from one rule exempts it from all of them):

- **Raw px font sizes.** No rule yet. When one lands it gets its own `file:line` list.
- **Hand-written base classes of the UNROLED primitives** in markup —
  `className="eui-btn …"`, `eui-input`, `eui-num`, `eui-link` on a raw element. R4
  guards only the classes registered in `CANONICAL_ROLES`, and those four belong to
  primitives in `UNROLED`, so ~57 call sites still wear a primitive's styling without
  being the primitive. Render the primitive and pass `className` for your own class
  (`<TextInput className="fld">`, `<LinkButton className="act">`); R15 already closed
  the CSS half of the same fork.

`ALLOWED_LEGACY` in the test is **empty and must stay empty** (`ds-contract.test.ts`,
`const ALLOWED_LEGACY: string[] = []`). It exists only so a large migration can land
in stages. What the staleness test actually asserts is narrow — that the **file** an
entry names still exists — so an entry is not proof its violation is still there; a
`file:line` entry must be re-checked by hand when the rule that needed it goes green.

Need a primitive to be a different size or sit differently? Add a prop with a
declared set of values, or pass `className` and style *your own* class. If you
find yourself reaching for `.eui-ds-*` from a feature stylesheet, the primitive is
missing an API — add it there.

## Type: two axes, never mixed
Size alone cannot tell a 17px headline from a 17px button label: caps at weight 800
with tracking carry far more visual mass than the same nominal size in sentence case.
That is how one `--fs-lg` ended up on both a dialog title and a shouting 48px REFRESH
pill. So there are two ladders, and a value takes exactly one of them.

**Reading** (`--fs-*`) — sentence case, weight 400–700, line-height ≥ 1.4:
`2xs` 11 · `xs` 12 · `sm` **13 = app body** · `md` 15 · `lg` 17 (object title) ·
`xl` 22 (full-window overlay title, first-run headline) · `2xl` 28 (page title) ·
`hero` `clamp(28px, 4.5vh, 44px)`.
`--fs-hero` is the only fluid step in the sheet and it has one consumer. A heading
*inside* a layout must not track the window, or it changes its relationship to the
paragraph under it on every resize.
The ramp is **px, and device pixels on purpose**: the editor is fixed chrome, so it
does not track the browser/OS root font size. Do not "restore" `rem` — that is the
mismatch (every step rendering 1.231× what the file said) this ladder was built to
close. App-wide scaling is `webContents.setZoomFactor`, not CSS.
There is no rung below `2xs`: the ~20 raw 10px type sites are the staged migration
above, and the rung that names them lands with them. A ladder step whose comment
claims surfaces it does not own is how the next author concludes the ramp is
decorative.

**Labels** (`--label-*`) — UPPERCASE, weight ≥ 600, tracking ≥ 0.04em:
`xs` 10 · `sm` 11 · `md` 13 · `lg` 14 · `xl` 15. There is deliberately nothing above
`--label-xl`.

For a **control**, the label rung is not a per-site decision — it is fixed by the height:

| height | token | label |
|---|---|---|
| 22px | `--control-h-xs` | `--label-xs` 10 |
| 26px | `--control-h-dense` | `--label-sm` 11 |
| 28px | `--control-h` | `--label-sm` 11 |
| 36px | `--control-h-md` | `--label-md` 13 |
| 40px | `--control-h-lg` | `--label-md` 13 |
| 48px | `--control-h-xl` | `--label-xl` 15 |

For a **non-control** label the rung is declared and reviewed: section headings on
display surfaces take `--label-lg` (14), form field labels `--label-sm` (11), panel
chrome `--label-xs` (10). A label must never land within a pixel of the value it
labels *and* outweigh it — that was "Sort by" at 15.6px/600 beside a 16px/400 value.

## Control metrics (enforced — R9)
Interactive controls come in six sanctioned heights, monotone, each a token in
`ds/styles/tokens.css`:
`--control-h-xl` (48px — **the first-run hero only**: Welcome's CTAs. A full-window
surface does not by itself earn this rung — the loading/error overlays own the whole
window, but their actions are an escape hatch and a retry, so they take `lg`. Reach for
48px when the control *is* the screen's purpose, not when the screen is merely large) ·
`--control-h-lg` (40px — forms, the launch-window toolbar row and the full-window
overlays' actions: Select default, SearchField lg) ·
`--control-h-md` (36px — dialog feet, secondary CTAs, topbar chrome, SearchField base,
`TextInput md`) ·
`--control-h` (28px — panel rows: Button, TextInput, SearchField sm, Select row) ·
`--control-h-dense` (26px — inspector prop rows: Select compact, NumberField) ·
`--control-h-xs` (22px — inline editors, `Button xs`).
Whatever rule sets a control's height — its own rule, a variant, or a context
override like `.eui-toolbar .eui-btn.primary` — takes `height: var(--control-h…)`,
never a raw px and never a `calc()` off one; R9 fails the build otherwise. A control
inset in a well is the one exception, and it is written as a **composition** of the
tokens it is inset from (`calc(var(--control-h-lg) - var(--seg-pad) - var(--seg-pad))`),
never as the number they happen to add up to. Controls sharing a flex
row share a scale *and a radius token*: a 28px SearchField next to a 26px Select is a
bug, and a `--r-pill` stadium next to a 14px card corner in one row is the same bug in
the other dimension. If a row needs a size a control lacks, add the size/density value
to the primitive, then its CSS.

Panel chrome has one more: `--head-h` (42px) is the height of every title bar —
`.eui-panel-head`, the assistant's `.eui-ai-head`, the Studio's `.eui-studio-head`. They
stack (inspector over assistant in the right dock), so the height is shared rather than
picked per panel; change the token, not the rule.

## Icons, spacing, radii, dialog widths
- **Icons** `--icon-xs` 12 · `sm` 16 · `md` 20 · `lg` 28 · `xl` 40. A glyph or spinner
  diameter is a rung, not a number — `Spinner` takes `size="lg"`, never `size={39}`.
- **Spacing** `--space-1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 24 · `6` 32 · `7` 40 ·
  `8` 48. Never a hand-picked px.
- **Radii** `--r-xs` 4 · `--r-control` 10 · `--r-card` 14 · `--r-panel` 18 ·
  `--r-pill`. A **control** takes `--r-control` or `--r-pill` and nothing else.
- **Dialog widths** `Modal` takes `size="sm|md|lg|xl"` → `--modal-w-*` 480/560/620/720,
  as a **max**-width. A dialog that declares no size stays content-sized, as today.
  "Make this dialog bigger" is that prop — never a caller's own `width` rule.

**A block owns the space around itself.** The recurring bug this prevents: a notice
with a 2px bottom margin looks right under a grid and sits flush against the next
sticky shelf header. If you are choosing a margin by looking at what happens to be
next to it today, the value is already wrong — put the spacing in the block's own
rule (or use `Notice`, which owns its own), so it travels with the block.

## Never scale, always name (enforced — R10, R11, R13)
Name the rung before you use it. A size that is not an `--fs-*`, `--label-*`,
`--control-h-*`, `--icon-*`, `--space-*`, `--r-*` or `--modal-w-*` token does not ship;
if the ladder has no rung, add the rung in the same PR, with the surfaces that claim it
named in its comment. That PR is reviewable — `calc(17px * 1.3)` is not.

Never declare a `--*-scale`, and never compute a metric by multiplication. `calc()`
composes (`top: calc(var(--space-2) + var(--control-h-md) + var(--space-2))`); it does
not scale. A primitive gets bigger by being **passed a size**, never by being
multiplied around it — the value comes from a closed union, so `tsc` rejects anything
else and the CSS is asserted to declare exactly that set.

A surface's tier is declared **per rule**, never inherited from an ancestor: no density
context, no root multiplier. That is what makes "did you convert this rule?" a grep and
a red test instead of a review someone loses — the rename input that kept its 13.5px
while every sibling grew is the rule that got lost.

And "make the whole app bigger" is not a CSS problem: it is
`webContents.setZoomFactor` in `packages/desktop` — one call, every metric including
the JSX-sized ones, no ladder forked.

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
