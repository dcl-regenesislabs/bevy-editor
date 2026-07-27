# Bevy Scene Editor

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

### macOS: "Bevy Scene Editor is damaged and can't be opened"

Current builds aren't signed with an Apple certificate yet, so macOS shows this
dialog for any copy downloaded with a browser — the app isn't actually damaged.

1. If the dialog is up, click **Cancel** (not *Move to Trash*).
2. Make sure the app is in your **Applications** folder.
3. Open **Terminal** (press ⌘Space, type "Terminal", press Enter).
4. Paste this line and press Enter (no output means it worked):

   ```bash
   xattr -d com.apple.quarantine "/Applications/Bevy Scene Editor.app"
   ```

5. Open the app normally.

First install only — auto-updates arrive without the quarantine flag, so you'll
never see the dialog again.

### Windows: "Windows protected your PC"

For the same reason (unsigned builds), SmartScreen may warn on first run. Click
**More info → Run anyway**.

## Your first scene

1. Open the app and pick **New scene** — start from a **blank** plot of land or
   the **starter** template (a small example scene to poke at).
2. The scene opens paused in the editor: drag in models, move them with the
   gizmos, tweak them in the inspector. The **Assets** panel has a catalog of
   ready-made models, plus a tile to add your own `.glb` / `.gltf` files from
   your computer.
3. Press **▶** to run the scene and walk around in it; **⏹** stops it and puts
   everything back the way you authored it.
4. Everything saves as a normal Decentraland scene folder on disk — other
   Decentraland tools can open the same project.

## Editing a scene

The viewport is a live scene, paused. A few behaviours are worth knowing:

| | |
|---|---|
| **Paused by default** | Opening a scene freezes it, so nothing ticks while you edit and the state you see is the state you save. ▶ runs it (edits made while running last only for that run), ⏹ restarts from the beginning and returns you to the spawn point. |
| **Editing the code** | Saving from Script Studio rebuilds and restarts the scene for you. Edits made anywhere else — your own editor, the AI assistant — rebuild but don't restart: press ⏹ to run them. |
| **Snap** | The grid button snaps gizmo drags to 0.5 m / 15° / 0.1× steps. Hold **⇧** while dragging to invert it — snap once when it's off, or move freely when it's on. Snapping applies to the drag as a whole, so a multi-selection keeps its spacing. |
| **Copy / paste / duplicate** | ⌘C / ⌘V / ⌘D on the selected entity — it brings the entity and everything under it. ⌘Z / ⇧⌘Z undo and redo; one gizmo drag is one undo step. |
| **Lock & hide** | Each hierarchy row has lock and eye toggles (the same flags the official Creator Hub uses, so they carry over). A locked entity can't be picked or dragged; a hidden one isn't drawn. |
| **`code` badge** | Marks an entity the scene's own code spawned rather than one you placed. You can select and inspect it, but changes to it aren't saved — the code recreates it on every run. |
| **`outside` badge** | The entity sits beyond the scene's parcels, where Decentraland won't render it in-world. |
| **Overlays** | The ⋯ menu toggles the invisible collision and trigger shapes, and the scene's spawn points (from `scene.json`). |

**Shortcuts:** ⌘/Ctrl+**Q W E R** switch between the Select / Move / Rotate /
Scale tools, ⌘/Ctrl+**F** focuses the selection, **Del** deletes it. Press **?**
in the editor for the full cheatsheet.

While a scene runs, play mode matches the in-world experience: a crosshair while
the mouse is captured for camera-look, and interaction prompts (**E**, etc.) on
whatever you're pointing at. A logs drawer in the topbar shows your scene's
console output and the local server logs, each in its own tab.

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

The floating ✨ button in the editor (drag it anywhere) opens a chat that
writes and edits your scene's **Script components** by prompt — "make this
door open when I get close" — directly in your project's script files. Press
⏹ to restart the scene on the new code.

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

Install either or both — the ✨ panel offers whichever is available, and if
none is set up it tells you what's missing; the rest of the editor works fine
without it.

**Script Studio** (the Script component's *Edit code in Studio* button) opens
the full view: your code and the chat side by side, with the 3D scene still
live. Select some code and press **⌘K** to ask about it (one-tap Explain / Fix
/ Comment / Improve). AI edits arrive as an **accept/reject diff** — nothing
touches your scene until you Accept.

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
