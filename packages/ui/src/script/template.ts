// Script scaffolding + path conventions. The class template mirrors the
// Creator Hub's ScriptInspector (constructor params after src/entity become
// the inspector's typed inputs), but scripts live under src/scripts — easier
// to find than the Hub's assets/scene/Scripts, and always inside the scene
// tsconfig's `src` include. Hub-authored scripts under assets keep working
// (the component stores the full path).

export const SCRIPTS_DIR = 'src/scripts'

/** Where a placed Trigger Area carries its occupancy bus, relative to src/scripts. */
export const ZONE_BUS_IMPORT = '../../custom/trigger_zone/scripts/runtime/zoneBus'

/**
 * The game module, relative to src/scripts, and the one place that path is
 * written. Nothing authors this file by hand: on a scene with a Multiplayer
 * Server the editor vendors the module and its whole closure into
 * src/scripts/runtime/, so `game.` autocompletes before a creator has typed the
 * import (prefabs/generate.ts).
 */
export const GAME_IMPORT = './runtime/game'

export function isScriptFile(value: string): boolean {
  return value.endsWith('.ts') || value.endsWith('.tsx')
}

const ATTACHABLE = new RegExp(`(?:^|/)(${SCRIPTS_DIR}/[^/]+\\.tsx?)$`)

// A path the assistant reported writing → the project path to attach, or null
// when it isn't a per-entity Script. The CLIs report paths absolute and
// symlink-resolved (main's rel() trims most of that; a Windows turn can still
// arrive with backslashes). src/index.ts and anything outside SCRIPTS_DIR
// attach to nothing.
export function attachablePath(reported: string): string | null {
  const m = ATTACHABLE.exec(reported.replace(/\\/g, '/'))
  return m === null ? null : m[1]
}

export function buildScriptPath(name: string): string {
  if (name.startsWith(SCRIPTS_DIR)) return name
  const scriptName = isScriptFile(name) ? name : `${name}.ts`
  return `${SCRIPTS_DIR}/${scriptName}`
}

export function toPascalCase(value: string, suffix = ''): string {
  const words = value
    .replace(/\.tsx?$/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0)
  const base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (base === '') return ''
  return base.endsWith(suffix) ? base : base + suffix
}

// The class shape is the Creator Hub's (@dcl/inspector
// ScriptInspector/templates.ts) — constructor params after src/entity become the
// inspector's typed inputs.
//
// Every script runs on BOTH sides, so the scaffold's whole teaching payload is
// the branch that says which one a line is on. Two rules it never bends:
//
//   1. The same three tokens, the same way round, in start() AND update(). An
//      inverted twin eight lines away (`if (!isServer())`) would make the reader
//      re-derive the meaning of `isServer()` per method.
//   2. update()'s server half ships already written. "update() runs on the
//      Multiplayer Server too, every frame" is the most surprising fact in the
//      model — our own reference fixture got it wrong — and a creator who has to
//      add the branch themselves is a creator who never learns the fact.
//
// The server's half is first only because the branch cannot be inverted; it is
// kept to one comment and a `return` so the client's half — where most first
// scripts go — is three lines away.
//
// `hasMultiplayerServer` gates the whole thing: `isServer` does not exist in the
// SDK a new scene ships with (sdk-capability.ts probes for exactly that name), so
// on a scene without the auth-server toolchain the branch would not compile.
// It defaults to the plain scaffold, which is also the right answer when the
// capability is unknown: a missing hint costs a creator nothing, a red file does.
export function getScriptTemplateClass(scriptName: string, hasMultiplayerServer = false): string {
  const pascal = toPascalCase(scriptName, 'Script')
  const className = pascal !== '' ? pascal : 'Script'
  const imports = hasMultiplayerServer
    ? `import { Entity } from '@dcl/sdk/ecs'\nimport { isServer } from '@dcl/sdk/network'\n`
    : `import { Entity } from '@dcl/sdk/ecs'\n`
  const startBody = hasMultiplayerServer
    ? `    if (isServer()) {
      // the Multiplayer Server: one copy, shared by every player
      return
    }
    // the client: this player's own copy
`
    : ''
  const updateBody = hasMultiplayerServer
    ? `    if (isServer()) {
      // the Multiplayer Server: update() runs here too, every frame
      return
    }
    // the client: this player's own copy, every frame
`
    : ''
  return `${imports}
export class ${className} {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
${startBody}  }

  update(dt: number) {
${updateBody}  }
}
`
}

// The reaction half of a Trigger Area: scaffolded straight onto the area, so the
// creator's answer to "what happens here" lives on the thing they placed.
//
// NO zone param. The script is attached to the area, so zoneOf() reads the name off
// this entity — asking the creator to also type it would be a second source of
// truth for something the attachment already settled.
//
// All three shapes are present because enter is only a third of the story: most
// reactions are really "while someone is inside" (a door with two people in it must
// not close when one leaves), which is what isInZone answers. It listens through the
// bus rather than triggerAreaEventsSystem because the SDK keeps ONE callback per
// (entity, event) — subscribing directly here would silently replace the detector.
//
// A reaction is client work by nature: only a player's own client knows where
// that player is. With a Multiplayer Server in the scene it says so in the same
// shape the New-script scaffold uses, or the two scaffolds would teach different
// models of the one fact they both exist to teach — and the server would run the
// bus listener and this update() every frame for an avatar it does not have.
export function getZoneReactionTemplate(scriptName: string, hasMultiplayerServer = false): string {
  const pascal = toPascalCase(scriptName, '')
  const className = pascal !== '' ? pascal : 'ZoneReaction'
  const serverImport = hasMultiplayerServer ? `\nimport { isServer } from '@dcl/sdk/network'` : ''
  const bail = hasMultiplayerServer ? `\n    if (isServer()) return\n` : ''
  return `import { Entity } from '@dcl/sdk/ecs'${serverImport}
import { isInZone, onZone, zoneOf } from '${ZONE_BUS_IMPORT}'

export class ${className} {
  private zone = ''
  private off: (() => void) | null = null

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {${bail}    this.zone = zoneOf(this.entity)

    // event.local is true when the avatar is this player's.
    this.off = onZone(this.zone, 'any', (event) => {
      if (!event.local) return
      if (event.kind === 'enter') {
        // What happens when they walk in.
      } else {
        // What happens when they leave.
      }
    })
  }

  update(dt: number) {${bail}    // For anything that should hold WHILE someone is inside, ask occupancy
    // instead of counting entries and exits yourself:
    // if (isInZone(this.zone)) { ... } else { ... }
  }
}
`
}
