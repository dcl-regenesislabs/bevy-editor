# The in-app AI assistant

> This doc covers the **assistant built into the app** (the chat panel /
> Script Studio). For driving or testing the *editor itself* with an external
> agent (console commands, editor bus, the CDP e2e harness), see
> [`AI-AGENT.md`](./AI-AGENT.md).

A floating 🤖 button in the editor — draggable, bottom-right by default — opens
a chat panel that edits your **Script components** by prompt. It's rendered by
`AiFab` (`packages/ui/src/panels/AiPanel.tsx`) and only exists in the desktop
app; a browser tab has no assistant.

---

## Two authoring surfaces

Code lives in two places, and the assistant is told the difference
(`DCL_SYSTEM_PROMPT`, `packages/desktop/src/ai.ts`):

- **Per-entity behavior** — a Script class in `src/scripts/<Name>.ts`, attached
  to an entity in the inspector.
- **Scene-global code** — the entry point `src/index.ts`: systems registered
  with `engine.addSystem`, shared state, entities the scene creates itself.

Which one it writes follows the request, and the file open in the Studio is part
of the turn context (`buildContext`) — with `src/index.ts` open, "every frame"
becomes a system there rather than a new Script class.

## The Studio

⤢ Code opens a three-column workspace: a **file rail** listing the whole
project, the editor, and the chat. Tabs are open documents — they merge and
persist, so selecting an entity never closes the file you were reading. Only
`.ts`/`.tsx` open; other files are listed greyed out, because the editor is
TypeScript-wired and restarts the scene on save (`src/script/project-files.ts`).

`src/index.ts` is **guarded** (`src/script/guarded.ts`): a save that doesn't
parse is refused outright — for both ⌘S and Accept — and the review diff stays
on screen. A missing `main()` only warns, since it has several legal shapes and
blocking on a heuristic would lock someone out of their own file.

## Image attachments

The composer accepts images — paste one, or attach via the 🖼 button (max 4,
8 MB each; png/jpeg/gif/webp). The renderer sends them as data URLs; the main
process writes them to a per-turn temp dir (`writeAttachments`,
`packages/desktop/src/ai.ts`) and hands the CLI file paths — appended to the
prompt for Claude (its Read tool renders images), passed as `-i` flags to
Codex. Files are kept for the app session so a resumed conversation can revisit
them; the OS owns temp cleanup beyond that.

## Process model

The assistant drives a local AI **CLI** — Claude Code (`claude`) or Codex
(`codex`) — as a child process of the Electron main, with the open project as
its working directory, so it edits files on disk. `sdk-commands` rebuilds on
write; the running scene keeps the old code until ⏹ restarts it on the new code.

## Billing & auth

Runs on your own subscription, not an API key. The child process inherits your
CLI's OAuth session; metered API-key env vars (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, custom base-URLs) are stripped from the child env so it can't
fall back to paid-per-token billing — and so an inherited base-URL override
can't redirect the OAuth token to a third party. Sign in once from a terminal
(`claude` / `codex login`).

## Permissions: full capability, no prompts

The assistant runs **unrestricted** in the open scene — file edits, shell,
network — because it is headless (there is no way to answer a permission
prompt) and because the SDK skills it follows assume a real toolchain:

| Provider | Flags |
|---|---|
| Claude | `--permission-mode bypassPermissions` |
| Codex | `--sandbox danger-full-access -c approval_policy="never"` |

Note what this means: an AI turn can run commands on your machine with your
privileges, so treat prompts — and scenes you got from other people, whose
files the assistant reads — with the same trust you'd give code you run.

## Providers

Claude and Codex are both wired; a backend whose CLI isn't installed/runnable
shows as unavailable in the switcher. Conversations resume across turns and are
per-provider — Claude via the `--resume <sessionId>` flag, Codex via the
`codex exec resume <threadId>` subcommand.

## The sdk-skills pipeline (`packages/desktop/src/skills.ts`)

SDK7 skills are always on. The app downloads
[decentraland/sdk-skills](https://github.com/decentraland/sdk-skills) at
startup into a userData cache (refreshed by commit SHA, atomically swapped,
offline keeps the last copy) and links it into the open scene as
`.claude/skills` (Claude) and `.agents/skills` (Codex's native discovery path),
so every provider gets the official SDK7 guidance by default.

- **Denylist**: a small denylist drops the `SKILL.md` of skills that duplicate
  what the editor itself does (scaffolding, deploy, SDK6 migration) so they
  never trigger, while still shipping their other files — several skills we
  *do* keep read `../<name>/references/` paths out of them.
- **Taken as-is**: the content is otherwise not sanitized: it is first-party
  Decentraland guidance feeding an assistant that already runs unrestricted, so
  there is nothing to gain by sanitizing it.
- **Never committed, never deployed**: every app-created link is
  `.gitignore`-covered (both the whole-dir symlink and the per-skill links when
  merging into a user's own `.claude/skills`), and dot-dirs never deploy
  (sdk-commands appends `.*` to every `.dclignore`, custom or not).
- **User dirs respected**: only links pointing into our own cache are ever
  repointed — a user's own symlink is left untouched — and a user's own
  `.claude/skills` dir is merged into, never replaced (their skill of the same
  name wins).

## Script Studio

The Script inspector's **"Edit code"** opens a full mode — the CodeMirror
editor and the chat side by side, with the 3D scene still live in the left
gutter.

- Select code and press **⌘K** to ask about it (one-tap Explain / Fix /
  Comment / Improve).
- AI edits arrive as an **accept/reject diff** (`@codemirror/merge`) — nothing
  runs in the scene until you Accept; Discard reverts.
- The editor is frozen while the AI writes so buffer and disk can't diverge.
- The narrow chat drawer and the Studio are one component
  (`panels/AiPanel.tsx` + `panels/ai-store.ts` + `script/code-editor.tsx`), so
  the conversation follows you between them.

## Wiring

`packages/desktop/src/ai.ts` (spawn + stream parsing) → IPC in
`main.ts`/`preload.ts` (`@dcl-editor/contract` `Ai*` types) → the
`packages/ui/src/panels/AiPanel.tsx` chat UI. The panel only appears in the
Electron shell (the renderer can't spawn processes).
