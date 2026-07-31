# Built-in prefabs

Prefabs shipped with the app. Each subfolder here is one prefab in the Creator
Hub custom-asset format — the same folder a scene keeps in `custom/<slug>/`:

```
<name>/
  data.json        { id, name, category: "custom", tags, origin: { source: "builtin" }, requiredPermissions? }
  composite.json   { version, components: [{ name, data: { "<localId>": { json } } }] }
  thumbnail.png    optional
  …resources       models, scripts, textures — relative structure preserved
```

They are listed in the editor's Prefabs tab under **Built-in** and are
read-only: placing one copies the folder into the open project first, so the
scene stays self-contained and deployable.

`data.json` must carry `"origin": { "source": "builtin" }` — that is what draws
the Built in badge and what stops the library offering Remove.

This folder ships as `resources/prefabs` in the packaged app (see
`electron-builder.yml`); in development it is read straight from here. Adding a
prefab is adding a folder — nothing registers it in code.

## admin-tools

The first built-in prefab: one entity carrying `asset-packs::AdminTools` (the
control config, edited through the Admin Tools inspector view) and
`asset-packs::Script` pointing at `{assetPath}/scripts/admin.tsx`.

`scripts/` is a self-contained port of the Creator Hub's admin toolkit — no npm
dependency beyond `@dcl/sdk`. The panel shell (tab bar, chrome, 1920×1080 canvas)
lives in `admin.tsx`; each tab is its own file under `scripts/tabs/` implementing
the `TabSpec` contract in `scripts/types.ts`. Icons ship in `icons/` (one
subfolder per tab) and are built from the `assetBase` the shell passes each tab,
so a prefab placed as `custom/admin-tools_2/` still finds its textures.

All five tabs are implemented: permissions & moderation (admin list, bans, kick),
video (URL, RTMP stream key, DCL Cast, speaker showcase), smart-item actions,
text announcements (with the overlay every player sees) and airdrops. What is not
ported: the DCL Cast presentation-bot flow and the rewards supply counter.

See `docs/PREFABS.md` for the format, the library layout and the known limits.
