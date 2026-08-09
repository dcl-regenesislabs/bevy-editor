// The observer that rides inside the Tower of Madness fixture scene.
//
// It plays the way a person does — walk into the start gate, climb to the
// summit — by teleporting this player's own avatar (the scene already declares
// the permission for Health & Respawn), and then reads back only what the server
// published. It never registers a handler of its own: `finish` belongs to
// madness-race.ts, one name has one handler, and the point is to prove that
// script's server half ran, not to stand in for it.
//
// The tower check is deliberately independent: the LCG and the constants below
// are a second copy, not an import, so a change to pure/tower.ts that the plan
// and the check follow together still fails here.
//
// LOCAL PREVIEW, stated once: `sdk-commands start` serves the scene to a client
// and nothing else. isServer() is false everywhere, no Multiplayer Server runs,
// so game.round.number stays 0, no layout is ever built and no request can be
// answered. Every record carries `server`, and probe-tower.mjs reports the
// server-side claims as skipped rather than passed when no round ever lands.
//
// Records leave the scene twice: as a console line (scene_logs) and as a
// TextShape on a throwaway entity (crdt_snapshot), because the log ring truncates.
import { TextShape, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { movePlayerTo } from '~system/RestrictedActions'
import { game } from './runtime/game'
import { spawnedFrom } from './runtime/spawner'

type PrefabRef = string

const MARK = '[TOWER]'
// Mirrors of pure/tower.ts, duplicated on purpose — see the header.
const CHUNK_KINDS = 10
const CHUNK_HEIGHT = 6
const BASE_X = 24
const BASE_Y = 2
const BASE_Z = 24
const MIN_FLOORS = 3
const MAX_FLOORS = 8

function plan(seed: number): number[] {
  let s = seed >>> 0
  const next = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const floors = MIN_FLOORS + Math.floor(next() * (MAX_FLOORS - MIN_FLOORS + 1))
  const picks: number[] = []
  for (let i = 0; i < MAX_FLOORS; i++) picks.push(Math.floor(next() * CHUNK_KINDS))
  return picks.slice(0, floors)
}

const published = new Set<string>()

function publish(key: string, value: Record<string, unknown>): void {
  if (published.has(key)) return
  published.add(key)
  const line = `${MARK} ${JSON.stringify({ tag: key.split(':')[0], server: isServer(), ...value })}`
  console.log(line)
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, -100, 0) })
  TextShape.create(entity, { text: line, fontSize: 1 })
}

/** Where the probe's avatar is asked to stand, in order. */
type Leg = 'gate' | 'summit'

export class TowerProbe {
  private elapsed = 0
  private leg: Leg | null = null
  private legAt = 0

  constructor(
    public src: string,
    public entity: Entity,
    /** The same middle chunks Tower Builder was given, in the same order. */
    public chunks: PrefabRef[] = [],
    /** The same cap. */
    public endChunk: PrefabRef = ''
  ) {}

  start(): void {
    // Deliberately unbranched: `server` on every record is what tells the probe
    // which sides actually booted, so both must publish.
    publish('boot', { entity: this.entity, chunks: this.chunks.length })
    // pure arithmetic: reachable on either side
    const a = plan(12345)
    const b = plan(12345)
    const other = plan(12346)
    publish('determinism', {
      sameSeedIdentical: a.join(',') === b.join(','),
      otherSeedDiffers: a.join(',') !== other.join(','),
      floors: a.length
    })
  }

  update(dt: number): void {
    if (isServer()) return
    this.elapsed += dt
    const round = game.round
    if (round.number <= 0) return
    publish('round', { number: round.number, seed: round.seed, phaseStartMs: round.phaseStartMs })
    this.checkTower(round.seed)
    this.walk(round.seed)
    this.watchFacts()
  }

  /** Every chunk the pools actually placed, against a plan derived from scratch. */
  private checkTower(seed: number): void {
    const wanted = plan(seed)
    const byFloor = new Map<number, string>()
    for (const [entity] of engine.getEntitiesWith(Transform)) {
      const from = spawnedFrom(entity)
      if (from === null) continue
      const at = Transform.get(entity).position
      const floor = Math.round((at.y - BASE_Y) / CHUNK_HEIGHT)
      if (Math.abs(at.x - BASE_X) > 0.01 || Math.abs(at.z - BASE_Z) > 0.01) continue
      byFloor.set(floor, from.prefab)
    }
    // the cap sits one floor above the last middle chunk
    if (byFloor.size < wanted.length + 1) return
    const mismatched: number[] = []
    for (const [floor, kind] of wanted.entries()) {
      if (byFloor.get(floor) !== this.chunks[kind]) mismatched.push(floor)
    }
    if (byFloor.get(wanted.length) !== this.endChunk) mismatched.push(wanted.length)
    publish('tower', {
      floors: wanted.length,
      placed: byFloor.size,
      kinds: wanted.join(','),
      mismatched,
      top: BASE_Y + CHUNK_HEIGHT * wanted.length
    })
  }

  /** Walk the run: into the gate, then up. The server validates both. */
  private walk(seed: number): void {
    if (this.leg === null) {
      if (this.elapsed < 12) return
      this.moveTo('gate', { x: BASE_X, y: BASE_Y + 0.5, z: 19 })
      return
    }
    if (this.leg === 'gate' && this.elapsed - this.legAt > 6) {
      this.moveTo('summit', { x: BASE_X, y: BASE_Y + CHUNK_HEIGHT * plan(seed).length + 1, z: BASE_Z })
    }
  }

  private moveTo(leg: Leg, at: { x: number; y: number; z: number }): void {
    this.leg = leg
    this.legAt = this.elapsed
    publish(`moved:${leg}`, { leg, at })
    void movePlayerTo({ newRelativePosition: at })
  }

  /** What the server decided, read off the synced state every player shares. */
  private watchFacts(): void {
    const finishers = game.state.finishers
    if (Array.isArray(finishers) && finishers.length > 0) {
      const clock = game.state.clock as { speed?: number } | undefined
      publish('finish', { finishers: finishers.length, speed: clock?.speed ?? 0 })
    }
    const board = game.state.leaderboard
    if (Array.isArray(board) && board.length > 0) {
      publish('board', { rows: board.length, first: JSON.stringify(board[0]) })
    }
  }
}
