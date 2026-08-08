// The tower, rebuilt every round from the round's seed.
//
// Nothing here crosses the wire. Each screen runs the same plan against the same
// seed, so every player climbs the same tower and a late joiner rebuilds it by
// arithmetic. One game.layout per chunk kind: a pool only ever places its own
// kind, and the plan says which floors that is.
import type { Entity } from '@dcl/sdk/ecs'
import { game } from './runtime/game'
import { BASE_X, BASE_Z, floorY, topFor, towerFor } from './pure/tower'

/** A prefab picked in the inspector. The annotation is what makes it a picker. */
type PrefabRef = string

export class TowerBuilder {
  constructor(
    public src: string,
    public entity: Entity,
    /** The middle chunks. Pick one prefab per kind; the seed picks the order. */
    public chunks: PrefabRef[] = [],
    /** The chunk that caps the tower — where a climb ends. */
    public endChunk: PrefabRef = ''
  ) {}

  start(): void {
    const kinds = this.chunks.filter((prefab) => prefab !== '')
    if (kinds.length === 0) {
      console.log('[towerBuilder] no chunks picked yet — the tower has nothing to build from.')
      return
    }
    kinds.forEach((prefab, kind) => {
      // the plan draws over CHUNK_KINDS; folding keeps every draw usable when a
      // creator picks fewer prefabs than that
      game.layout(prefab, (_rng, round) =>
        towerFor(round.seed).flatMap((pick, floor) =>
          pick % kinds.length === kind ? [{ x: BASE_X, y: floorY(floor), z: BASE_Z }] : []
        )
      )
    })
    if (this.endChunk !== '') {
      game.layout(this.endChunk, (_rng, round) => [{ x: BASE_X, y: topFor(round.seed), z: BASE_Z }])
    }
  }
}
