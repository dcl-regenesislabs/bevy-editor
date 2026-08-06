# Decentraland Studio

A desktop app for building and publishing [Decentraland](https://decentraland.org)
scenes and worlds — a modern take on the Creator Hub, powered by the
[Bevy](https://bevyengine.org)-based [bevy-explorer](https://github.com/decentraland/bevy-explorer)
engine. Edit your scene in a live 3D viewport, write behaviour with the built-in
AI assistant, and publish straight to your Decentraland world.

## Download & install

Grab the installer for your platform from the
[**latest release**](https://github.com/dcl-regenesislabs/bevy-editor/releases):

- **macOS** — `.dmg` for Apple Silicon or Intel (~205 MB download, ~525 MB
  installed). Not sure which chip you have? Apple menu → **About This Mac** —
  Macs from 2021 on are Apple Silicon.
- **Windows** — 64-bit installer `.exe` (~165 MB download, ~580 MB installed)

The installer is self-contained — nothing else to install to build and publish
scenes. (The optional [AI assistant](#ai-assistant-optional) is the one
exception; it needs one extra tool.) You'll want a GPU that can drive a 3D
viewport and about 600 MB of disk.

### macOS: "Decentraland Studio is damaged and can't be opened"

Current builds aren't signed with an Apple certificate yet, so macOS shows this
dialog for any copy downloaded with a browser — the app isn't actually damaged.

1. If the dialog is up, click **Cancel** (not *Move to Trash*).
2. Make sure the app is in your **Applications** folder.
3. Open **Terminal** (press ⌘Space, type "Terminal", press Enter).
4. Paste this line and press Enter (no output means it worked):

   ```bash
   xattr -d com.apple.quarantine "/Applications/Decentraland Studio.app"
   ```

5. Open the app normally.

First install only — auto-updates arrive without the quarantine flag, so you'll
never see the dialog again.

### Windows: "Windows protected your PC"

For the same reason (unsigned builds), SmartScreen may warn on first run. Click
**More info → Run anyway**.

## Your first scene

1. Open the app and pick **New scene** — start from a **blank** plot of land or
   the bundled **starter** (a small example scene to poke at).
2. The scene opens paused in the editor: drag in models, move them with the
   gizmos, tweak them in the inspector. The **Assets** panel has a catalog of
   ready-made models, plus a tile to add your own `.glb` / `.gltf` files from
   your computer — if a model keeps its textures in separate files, select
   them together with it and the editor brings them all in. The **Prefabs**
   tab next to it holds the pieces you've saved for reuse — in this scene, in
   your own cross-scene library, or shipped with the editor.
3. Press **▶** to run the scene and walk around in it; **⏹** stops it and puts
   everything back the way you authored it.
4. Everything saves as a normal Decentraland scene folder on disk — other
   Decentraland tools can open the same project.

## Editing a scene

The viewport is a live scene, paused. A few behaviours are worth knowing:

| | |
|---|---|
| **Paused by default** | Opening a scene freezes it, so nothing ticks while you edit and the state you see is the state you save. ▶ runs it (edits made while running last only for that run), ⏹ restarts from the beginning and returns you to the spawn point. |
| **Editing the code** | Saving from Script Studio rebuilds and restarts the scene for you. Code changed anywhere else — your own editor, the AI assistant — rebuilds too, and ▶ waits for that build and loads it before it runs, so you never have to restart by hand. |
| **Snap** | The grid button snaps gizmo drags to 0.5 m / 15° / 0.1× steps. Hold **⇧** while dragging to invert it — snap once when it's off, or move freely when it's on. Snapping applies to the drag as a whole, so a multi-selection keeps its spacing. |
| **Copy / paste / duplicate** | ⌘C / ⌘V / ⌘D on the selected entity — it brings the entity and everything under it. ⌘Z / ⇧⌘Z undo and redo; one gizmo drag is one undo step. |
| **Prefabs** | Select what you built in the **Scene** tab, right-click it and pick **Create prefab…** (the ▣ button above the hierarchy does the same) to save it — entities, models, scripts and all — into the project's `custom/` folder. It shows up in the **Prefabs** tab of the left panel (`⌥P`): click a card or drag it into the viewport to drop another copy in front of the camera. Copies are independent — editing one doesn't change the others. Rows placed from a prefab carry a ▣ marker, and the inspector says which prefab they came from — with **Compare…** to see what you changed on this copy, then either save your changes back into the prefab or take the prefab's version. |
| **Prefab library** | The Prefabs tab groups cards by where they live: **This project**, **My library** (yours, shared by every scene on this computer) and **Built-in** (shipped with the editor). **Save to my library** on a project prefab files it away for the next scene; placing a library or built-in prefab copies it into this project first, so the scene stays complete on its own. The import button takes a prefab folder, a `.zip` or a GitHub link — GitHub imports are pinned to the commit they came from, and because prefabs can carry scripts, you see every script file before anything is added. When a newer version of a built-in prefab ships with an editor update, its card (and the inspector row of placed copies) shows an **Update** chip — click it to see what changed and bring your copy up to date; script settings you edited are kept. |
| **Admin Tools** | A built-in prefab: drop it in and your scene gets an in-world admin panel — moderation, video screens, smart-item actions, announcements. Only admins see it (in preview, that's everyone); who counts as one is set in the **Admin Tools** section of the inspector, along with which screens and smart items the panel can drive. Placing it adds the scene permissions it needs. |
| **Multiplayer scenes** | New scenes come with their own game server: press **Play** and the scene runs with a live Multiplayer Server behind it — the same one it gets when published. The built-in **Server Clock** prefab shows the server's synced clock, identical for every player — drop it in to see multiplayer working with zero setup. |
| **Trigger Zone** | A built-in prefab: an invisible area that knows who is standing in it. Click **Trigger Zone** in the toolbar — the area drops in front of the camera and its hierarchy row opens ready for you to type a name, and that name is the zone. Then drag it into place and use the scale handles until it covers the doorway or the arena. Its settings say who it reacts to (just you, or anyone), how often an entry counts, and how long someone may step out before they count as gone. Other scripts react by asking for the zone by name, so nothing has to be wired up; ask the AI assistant to "open this when someone's in Front Hall" and it writes that script for you. Zones are trusted to each player's own game, which is right for doors, lights and sound; if a zone hands out something worth cheating for, add the **Zone Authority** prefab (in the Prefabs tab, under **Multiplayer Server**) and the server double-checks where the player really is. |
| **Spawner** | A built-in prefab that makes copies of another prefab appear while the game runs — the enemies, the crates, the pickups. The quickest way in is the right-click menu: right-click anything in the scene and pick **Add a spawner**, and a spawner drops onto it already wired — to a Trigger Zone it fires when a player walks in, to anything else when a player clicks it. Then pick what appears from its dropdown. The rest of its settings are the whole design: on a timer, or when another script asks for it by name; how many copies may exist at once and how long each one sticks around — several copies spread out on their own so they don't stack. The Multiplayer Server decides every copy, so every player sees the same ones in the same place — no wiring, no code. |
| **Game kit** | Under **Multiplayer Server** in the Prefabs tab there are five more prefabs that make a round-based game without code. **Round Loop** is the clock the rest hang off: lobby, wave, break, wave — one countdown, the same for everybody. **Wave Director** sends the enemies, reading the numbers from **Game Config**, so you rebalance a fight by editing a table instead of a script. **Level Slots** swaps the arena between rounds. **Player Rig** gives every player a nameplate, a health bar and a gun. **Leaderboard** is a board on a panel that survives a restart. Each one carries a guide the AI assistant reads before writing anything that touches it. |
| **Spawning prefabs** | Every prefab can be spawned by your game — the zombies, the pickups. Build the thing in the scene, right-click it and pick **Create prefab…**: the dialog asks a name and when it appears — *From the start*, or *When spawned* (it moves to the Prefabs tab and the game brings copies in while playing). Pick the prefab in a spawner's dropdown — the **Spawner**'s, or the Wave Director's — and that is the whole setup. *From the start* and a Spawner are not the same thing: the folder holds the one you built, placed once; a Spawner brings in a fresh copy each time, capped and timed. The scene tree shows the split: **From the start** holds what players see the moment the game begins, **When spawned** holds what you built for the game to bring in while it plays — ordinary entities either way, edited in place, moved between the folders from the right-click menu. The card's chips say what the game guarantees about those copies: what the server owns, and what each player's own screen decides. |
| **Scene checks** | A card in the editor that reads what you wired together and says what cannot work — a wave spawning more enemies than the prefab allows alive at once, the same number set in two places, a placed copy you changed but never saved back to its prefab. The serious ones hold Play until they are fixed, with **Play anyway** if you disagree. |
| **Game Config** | A table of the numbers your game runs on — how many enemies in wave 5, how much damage a bite does. Open it from the table button at the top of the **Scene** panel; it is written out as one file every script reads. Change a number and it lands at the next round, without a code edit. |
| **Folders** | Keep the tree tidy: select things that belong together and press `⌘G` (or right-click → **Group into a folder**) — the selection is wrapped in a folder, ready for you to name. Drag rows in or out any time; nothing moves in the world, because a folder organizes without placing: it has no position, no gizmo, nothing to click in the viewport. **Ungroup** (`⇧⌘G`) moves the contents up a level and removes the folder, and the folder button above the tree makes an empty one. Hiding or locking a folder carries everything inside it, and moving a folder between **From the start** and **When spawned** moves its whole group's place in the game. |
| **Lock & hide** | Each hierarchy row has lock and eye toggles (the same flags the official Creator Hub uses, so they carry over). A locked entity can't be picked or dragged; a hidden one isn't drawn. |
| **`code` badge** | Marks an entity the scene's own code spawned rather than one you placed. You can select and inspect it, but changes to it aren't saved — the code recreates it on every run. |
| **`outside` badge** | The entity sits beyond the scene's parcels, where Decentraland won't render it in-world. |
| **Overlays** | The ⋯ menu toggles the invisible collision and trigger shapes, and the scene's spawn points (from `scene.json`). |

**Shortcuts:** ⌘/Ctrl+**Q W E R** switch between the Select / Move / Rotate /
Scale tools, ⌘/Ctrl+**F** focuses the selection, **Del** deletes it — it asks
first, since it takes the whole entity and everything under it (tick *Don't ask
again* if you'd rather it didn't). ⌘Z brings back a deleted entity, or a
component you removed from the inspector. Press **?** in the editor for the full
cheatsheet.

While a scene runs, play mode matches the in-world experience: a crosshair while
the mouse is captured for camera-look, and interaction prompts (**E**, etc.) on
whatever you're pointing at. A logs drawer in the topbar shows your scene's
console output and the local server logs, each in its own tab.

## Preview anywhere

The **Preview** button in the topbar opens the scene you're editing in other
Decentraland clients — all of them join the same live preview, so edits show
up as you make them:

- **In your browser** — opens the web explorer in your default browser,
  pointed at your scene.
- **On your phone** — shows a QR code; scan it with your phone's camera to
  open the scene in the Decentraland mobile app. Phone and computer must be
  on the same network.
- **In Decentraland Desktop** — jumps into the scene in the official
  [Decentraland client](https://dcl.gg/explorer), if you have it installed.

## Sign in with Decentraland

Publishing needs a Decentraland account. In Home's **Account** section hit
**Sign in**: your browser opens decentraland.org, you log in there, and it
bounces you back into the app. The app stores the resulting identity locally
and signs your deployments with it — no passwords or keys ever touch the app.

> If you also have the official Creator Hub installed, the browser's
> bounce-back link may open it instead of this app. Uninstalling or closing it
> works around the clash for now.

## Publish to a world

**What you need:** a Decentraland account (sign in above), plus either a
[NAME](https://decentraland.org/marketplace/names/claim) you own (claiming one
costs MANA) or a collaborator invite from someone who owns one — every world
lives on a NAME. If your Worlds tab is empty, you don't have either yet.

The **Worlds** tab in Home shows every world you can publish to — worlds on
NAMEs you own, plus worlds where someone added you as a collaborator. It's
always fetched live from the servers, so what you see is what's actually
deployed, no matter which tool or machine deployed it.

- **Publish** from a scene card, the in-editor topbar button, or a world's
  page: pick the world, the app builds and uploads, then offers to jump in.
  Scenes remember the world they publish to and show it as a badge.
- Each world's page also manages the world itself: **Permissions**
  (who can deploy, enter, or stream), **Streaming** (generate the OBS stream
  key), **Moderation** (admins and bans), and — for multiplayer scenes —
  **Storage** (browse and edit the world's server-side data) and **Logs**
  (a live tail of the world's server output).

## AI assistant (optional)

The floating 🤖 button in the editor (drag it anywhere) opens a chat that
writes and edits your scene's code by prompt — "make this door open when I get
close" — directly in your project's files. Press ▶ to run what it wrote; the
editor builds and loads the new code for you.

Ask for behavior on the selected object and it writes a **Script component**,
already attached to that object — nothing for you to wire up. Ask for something
scene-wide ("spin everything", "on start") and it writes into your scene's entry
point, `src/index.ts`. Hit **⤢ Code** to see your project's
files, open any of them side by side with the chat, and edit them yourself.
You can also paste or attach screenshots and reference images — "make the door
look like this" — and the assistant sees them.

It works through an AI coding tool installed on your machine, billed to **that
tool's subscription** (Claude Pro/Max for Claude Code, a ChatGPT plan for
Codex) — no API key, no per-token charges. Setting one up is the one terminal
moment in this app:

1. Install [Node.js](https://nodejs.org) (the LTS installer) if you've never
   had it — it provides the `npm` command used below.
2. Open Terminal (macOS) or PowerShell (Windows), paste one of these, press
   Enter:
   - **Claude Code**: `npm i -g @anthropic-ai/claude-code`, then run `claude`
     once and follow its sign-in.
   - **Codex**: `npm i -g @openai/codex`, then `codex login`.

Install either or both — the assistant panel offers whichever is available, and if
none is set up it tells you what's missing; the rest of the editor works fine
without it.

**Script Studio** (the Script component's *Edit code in Studio* button) opens
the full view: your code and the chat side by side, with the 3D scene still
live. Select some code and press **⌘K** to ask about it (one-tap Explain / Fix
/ Comment / Improve). AI edits arrive as an **accept/reject diff** — nothing
touches your scene until you Accept.

The Studio speaks editor: **⌘P** jumps to any file, **⌘F** finds in the open
one, **⌘S** saves, **⌘W** closes the tab, **⌘⇧[** / **⌘⇧]** cycle tabs, and
**Esc** closes the Studio (your unsaved edits are flushed first).

> **A word of caution:** the assistant can change any file in your scene
> project — and run commands on your computer — without asking first. Only use
> it on scenes and prompts you trust, especially scenes downloaded from other
> people. Details in [`docs/AI-ASSISTANT.md`](./docs/AI-ASSISTANT.md).

## Staying up to date

The app updates itself: it checks GitHub for new releases in the background,
downloads silently, and shows a passive **Restart to update** notice when one
is staged — ignore it and the update simply installs the next time you quit.
After an update, a one-time **What's new** toast links to the release notes
([all releases](https://github.com/dcl-regenesislabs/bevy-editor/releases)).

## Troubleshooting

- **macOS says the app is damaged** — it's the unsigned-build quarantine flag;
  see [the install note](#macos-bevy-scene-editor-is-damaged-and-cant-be-opened).
- **Sign-in never returns to the app** — check whether the official Creator
  Hub is installed; it can capture the sign-in link (see
  [Sign in](#sign-in-with-decentraland)).
- **Blank or black viewport** — the 3D engine needs a working GPU; update your
  graphics drivers, and avoid running over remote desktop.

Stuck on something else? [Open an issue](https://github.com/dcl-regenesislabs/bevy-editor/issues) —
it helps us and the next creator.

## Learn more

- [Decentraland creator docs](https://docs.decentraland.org/creator/) — scenes,
  worlds, NAMEs, the SDK
- [Release notes](https://github.com/dcl-regenesislabs/bevy-editor/releases) —
  what's new in each version

## For developers

This repo is an npm-workspaces monorepo (React UI + Electron shell + an SDK7
scene that implements the editor gizmos, on top of an unmodified prebuilt
bevy-explorer engine). To build from source or contribute:

- [`docs/SETUP.md`](./docs/SETUP.md) — clone-to-running runbook
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev loop, conventions, docs index
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — how the pieces fit together
- [`AGENTS.md`](./AGENTS.md) — the modify → build → validate loop (for AI
  agents and humans alike)
