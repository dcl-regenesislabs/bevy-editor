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
 * The game module, relative to src/scripts. Nothing writes this file by hand:
 * the import is what makes the editor vendor the module and its whole closure
 * into src/scripts/runtime/ (prefabs/generate.ts).
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

// One name has one handler across the whole scene, and two scripts claiming the
// same one is an error at runtime — so the scaffold's name comes from the file
// rather than a shared placeholder, or a creator's second new script would throw
// before they had typed anything.
function messageName(scriptName: string): string {
  const pascal = toPascalCase(scriptName)
  return pascal === '' ? 'example' : pascal[0].toLowerCase() + pascal.slice(1)
}

// The class shape is the Creator Hub's (@dcl/inspector
// ScriptInspector/templates.ts) — constructor params after src/entity become the
// inspector's typed inputs. The body carries ONE comment: where a decision that
// counts for everyone goes. The rest of the story (per-frame code, variables not
// crossing between the two halves) is taught where the mistake happens, by the
// cross-color check, not pre-emptively here.
export function getScriptTemplateClass(scriptName: string): string {
  const pascal = toPascalCase(scriptName, 'Script')
  const className = pascal !== '' ? pascal : 'Script'
  return `import { Entity } from '@dcl/sdk/ecs'
import { game } from '${GAME_IMPORT}'

export class ${className} {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    // Decisions that count for everyone go inside game.onMessage — that code runs on the server.
    game.onMessage('${messageName(scriptName)}', (data, player) => {
    })
  }

  update(dt: number) {
  }
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
export function getZoneReactionTemplate(scriptName: string): string {
  const pascal = toPascalCase(scriptName, '')
  const className = pascal !== '' ? pascal : 'ZoneReaction'
  return `import { Entity } from '@dcl/sdk/ecs'
import { isInZone, onZone, zoneOf } from '${ZONE_BUS_IMPORT}'

export class ${className} {
  private zone = ''
  private off: (() => void) | null = null

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    this.zone = zoneOf(this.entity)

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

  update(dt: number) {
    // For anything that should hold WHILE someone is inside, ask occupancy
    // instead of counting entries and exits yourself:
    // if (isInZone(this.zone)) { ... } else { ... }
  }
}
`
}
