# packages/ui conventions

## Where code goes
- `src/ds/` — design-system primitives. One `<Name>.tsx` + sibling `<Name>.css` per component.
- `src/features/<domain>/` — screens/features (home, editor, worlds, publish, account, ai).
  PascalCase components; one css file per feature (split per component when it grows).
  No feature barrels; import features by full path.
- `src/lib/` — cross-cutting non-UI helpers (formatting, api clients).
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

## State
- Feature stores: module singleton + `useSyncExternalStore` (auth.ts, worlds.ts) or the
  `reactive()`/`useStore` idiom (panels/ai-store.ts). Exported mutator functions, not setters.
- Per-request UI state: `useLoad` from `ds/hooks` — not module singletons.
