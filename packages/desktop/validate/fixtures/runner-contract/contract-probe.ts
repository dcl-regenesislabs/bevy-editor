// Fixture for probe-script-runner.mjs — the runner-contract probe.
//
// One Contract-v1 class exercising every param type the editor can author, so
// the SAME script can be dispatched twice inside one scene: once on a placed
// entity by the SDK's own runner (@dcl/sdk-commands/dist/logic/runtime-script.js)
// and once on a clone by packages/desktop/runtime-modules/spawner.ts. The probe
// diffs the two records field for field; anything that differs is a runner-parity
// bug, which is a silent gameplay bug rather than a build error.
//
// Records go out on two channels because neither alone survives a CDP harness:
// the scene log ring (which can roll over before the probe polls) and a TextShape
// in the CRDT (durable while the scene runs, and reset by a rebuild — which is
// what makes it a single-run set).
//
// This file lives outside every tsconfig `include` on purpose: it compiles only
// inside a scene, against that scene's own SDK pin.

import { engine, TextShape, type Entity } from '@dcl/sdk/ecs'
import { getActionEvents } from '@dcl/asset-packs'

type ActionCallback = () => void
type PrefabRef = string
type ProbeMode = 'alpha' | 'beta'

// The 'action' param's only observable effect is an emit into this entity's
// action bus, so the probe counts emits to prove both paths built a real,
// equivalent callback rather than passing the raw {entity, action} record.
const ACTION_ENTITY = 512
const ACTION_NAME = 'probe_action'
const SCRIPT_FILE = 'contract-probe.ts'
const TAG = '[RUNNER-CONTRACT]'

interface ProbeShared {
  order: number
  updateOrder: number
  emits: number
  records: string[]
  report: Entity | null
  clone: number | null
  publish: (record: Record<string, unknown>) => void
}

const globals = globalThis as unknown as { __RUNNER_PROBE__?: ProbeShared }

const shared: ProbeShared = (globals.__RUNNER_PROBE__ ??= {
  order: 0,
  updateOrder: 0,
  emits: 0,
  records: [],
  report: null,
  clone: null,
  publish
})

getActionEvents(ACTION_ENTITY as unknown as Entity).on(ACTION_NAME, () => {
  shared.emits += 1
})

function publish(record: Record<string, unknown>): void {
  const line = `${TAG} ${JSON.stringify(record)}`
  shared.records.push(line)
  console.log(line)
  const text = shared.records.join('\n')
  if (shared.report === null) {
    shared.report = engine.addEntity()
    TextShape.create(shared.report, { text })
    return
  }
  TextShape.getMutable(shared.report).text = text
}

export class ContractProbe {
  private ticked = false

  constructor(
    public src: string,
    public entity: Entity,
    public num = 0,
    public flag = false,
    public label = '',
    public target = 0,
    public mode: ProbeMode = 'alpha',
    public onHit: ActionCallback = () => {},
    public arena: PrefabRef = '',
    public arenas: PrefabRef[] = []
  ) {}

  start(): void {
    const before = shared.emits
    let onHitError = ''
    try {
      this.onHit()
    } catch (error) {
      onHitError = String(error)
    }
    shared.publish({
      tag: 'start',
      path: `${this.src}/${SCRIPT_FILE}`,
      src: this.src,
      entity: Number(this.entity),
      params: {
        num: this.num,
        flag: this.flag,
        label: this.label,
        target: this.target,
        mode: this.mode,
        onHit: typeof this.onHit,
        onHitEmits: shared.emits - before,
        onHitError,
        arena: this.arena,
        arenas: this.arenas
      },
      order: ++shared.order
    })
  }

  update(_dt: number): void {
    if (this.ticked) return
    this.ticked = true
    shared.publish({
      tag: 'update',
      path: `${this.src}/${SCRIPT_FILE}`,
      entity: Number(this.entity),
      order: ++shared.updateOrder
    })
  }

  /** @action Reachable through callScriptMethod on both dispatch paths. */
  ping(n: number): string {
    return `pong:${this.label}:${n}`
  }
}
