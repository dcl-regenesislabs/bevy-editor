# runtime-modules

Master copies of the multiplayer helper modules that **prefabs carry into
scenes**. This folder is not a library scenes depend on and is never vendored
into templates wholesale — a blank scene ships zero runtime code.

The model (same as the seat prefabs' `ui-owner.ts`):

- Each built-in prefab's scripts import the specific modules they need with
  relative paths. When the prefab is instantiated, those module files are
  copied into the scene next to the prefab's scripts.
- Identical files already present in the scene are reused, not duplicated —
  two prefabs share one copy, so modules cannot drift *within* a scene.
- A bug fix lands here and reaches scenes through the normal prefab-update
  path. Blast radius of a change = scenes using a prefab that carries the
  module, never "every scene".

Rules for modules in this folder:

- Small, single-purpose files; no barrel exports (a barrel drags unused
  modules — and their module-scope side effects like `registerMessages` —
  into every bundle).
- `pure/` holds SDK-free logic, unit-tested from
  `packages/desktop/src/runtime-pure.test.ts`. SDK-bound modules are
  compile-verified by the scene harness against the pinned auth-server SDK.
- Extracted from shipped games: `timeSync` (Tower of Madness), `playerStore`
  (Dead Surge), `rng` (DCL-Hazards-POC).
