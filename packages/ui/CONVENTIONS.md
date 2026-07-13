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
