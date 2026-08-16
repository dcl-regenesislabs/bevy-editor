// Every state the publish dialog can be in, enumerated once.
//
// Two guards read this list: publish-view.test.tsx asserts the DESCRIPTOR each
// state produces, publish-skeleton.test.tsx mounts the real dialog in each state
// and asserts the rendered DOM. They have to agree on what "every state" means —
// two hand-kept lists drift apart exactly the way the dialog's two if-ladders
// did, and a state that is missing from one list is a state with no guard at all.
//
// `family` is stated here rather than read back out of publishView: it is the
// spec's own table, and it is what the per-state action caps are checked
// against, so it cannot come from the code under test.
//
// Adding a state to the dialog means adding a case here. Nothing else in either
// guard has to change — which is the point.
import type { OccupyingScene } from './publish-conflict'
import { offlineOldSdkNote, oldSdkNote } from './publish-copy'
import type { ConflictReview, PublishState, UnreadableReview } from './publish-flow'
import type { PublishFamily, PublishMark } from './publish-view'
import type { WorldEntry } from '../worlds/inventory'
import type { WorldsState } from '../worlds/worlds-store'

export const SCENE_DIR = '/scene'
export const SCENE_TITLE = 'My Scene'
export const WALLET = '0xaaaa'
/** the world the picker offers, and the one C1 is pointed at */
export const PICKED_WORLD = 'cozyfarm.dcl.eth'
/** the world a running/finished job names — deliberately not the picked one, so
 *  a state that reads the wrong source of truth shows up in the copy */
export const JOB_WORLD = 'w.dcl.eth'

export const TSC_ERROR = "src/index.ts:10:3 - error TS2307: Cannot find module 'x'"

export const IDLE_JOB: PublishState = {
  phase: 'idle',
  dir: SCENE_DIR,
  world: null,
  logs: [],
  error: null,
  jumpIn: null,
  at: null,
  total: null,
  review: null,
  blocked: null
}

export const job = (over: Partial<PublishState>): PublishState => ({ ...IDLE_JOB, ...over })

export const worldEntry = (name: string): WorldEntry => ({
  name,
  role: 'owner',
  size: null,
  scenes: [],
  sceneCount: { known: true, total: 2 },
  settings: null,
  image: null,
  userCount: null
})

export const OCCUPYING: OccupyingScene = {
  entityId: 'bafy',
  deployer: '0xbbbb',
  title: 'Museum',
  base: '4,4',
  parcels: ['4,4'],
  timestamp: null
}

export const CONFLICT: ConflictReview = {
  kind: 'conflict',
  scenes: [OCCUPYING],
  mine: ['4,4'],
  move: null,
  moveNote: null,
  working: false
}
export const MOVED: ConflictReview = { ...CONFLICT, move: { base: '9,9', parcels: ['9,9'] } }
export const UNREADABLE: UnreadableReview = { kind: 'unreadable' }

export type WorldsStatus = WorldsState['status']

export interface PublishCase {
  /** the spec's id for this state (§6) */
  id: string
  family: PublishFamily
  /** the disc this state wears, stated here for the same reason `family` is:
   *  the icon and its tone were the last thing a state could still pick for
   *  itself, and a table the code cannot read is what makes that checkable */
  mark: PublishMark
  /** only the conflict review left-aligns — it is the one body with a diagram */
  align?: 'start'
  job?: PublishState
  wallet?: string | null
  worlds?: WorldEntry[]
  worldsStatus?: WorldsStatus
  worldsError?: string | null
  picked?: string | null
}

export interface PublishCaseState {
  job: PublishState
  wallet: string | null
  worlds: WorldEntry[]
  worldsStatus: WorldsStatus
  worldsError: string | null
  picked: string | null
}

/** the case with its defaults filled in — the keys are a subset of
 *  PublishViewInput, so a descriptor test can spread it straight in */
export function caseState(c: PublishCase): PublishCaseState {
  return {
    job: c.job ?? IDLE_JOB,
    wallet: c.wallet === undefined ? WALLET : c.wallet,
    worlds: c.worlds ?? [worldEntry(PICKED_WORLD)],
    worldsStatus: c.worldsStatus ?? 'ready',
    worldsError: c.worldsError ?? null,
    picked: c.picked === undefined ? PICKED_WORLD : c.picked
  }
}

// The message the flow would have recorded, not a placeholder: the guards read
// the note a creator would be looking at.
const blocked = (kind: 'old-sdk' | 'offline'): PublishState =>
  job({
    phase: 'blocked',
    world: JOB_WORLD,
    blocked: { kind, message: kind === 'offline' ? offlineOldSdkNote(JOB_WORLD) : oldSdkNote(JOB_WORLD) }
  })

const review = (r: ConflictReview | UnreadableReview, phase: 'review' | 'checking'): PublishState =>
  job({ phase, world: JOB_WORLD, review: r })

export const PUBLISH_CASES: PublishCase[] = [
  { id: 'B1', family: 'blocked', mark: 'world', wallet: null },
  { id: 'B2', family: 'blocked', mark: 'world', worlds: [], worldsStatus: 'ready', picked: null },
  // empty AND failed: a refresh that fails does not drop the worlds the store
  // already holds, and a list we still have is not a state that refuses to publish
  { id: 'B3', family: 'blocked', mark: 'problem', worlds: [], worldsStatus: 'error', worldsError: 'Network unreachable' },
  { id: 'B4', family: 'blocked', mark: 'problem', job: blocked('old-sdk') },
  { id: 'B5', family: 'blocked', mark: 'problem', job: blocked('offline') },
  { id: 'C1', family: 'choose', mark: 'none' },
  { id: 'W1', family: 'wait', mark: 'none', job: job({ phase: 'checking', world: JOB_WORLD }) },
  { id: 'W2', family: 'wait', mark: 'none', job: job({ phase: 'building', world: JOB_WORLD, logs: ['compiling'] }) },
  { id: 'W3', family: 'wait', mark: 'none', job: job({ phase: 'uploading', world: JOB_WORLD, logs: ['compiling'] }) },
  { id: 'D1', family: 'decide', mark: 'none', align: 'start', job: review(CONFLICT, 'review') },
  { id: 'D2', family: 'decide', mark: 'none', align: 'start', job: review(CONFLICT, 'checking') },
  { id: 'D3', family: 'decide', mark: 'none', align: 'start', job: review({ ...CONFLICT, working: true }, 'review') },
  { id: 'D4', family: 'decide', mark: 'none', job: review(MOVED, 'review') },
  { id: 'D5', family: 'decide', mark: 'none', job: review(MOVED, 'checking') },
  { id: 'D6', family: 'decide', mark: 'none', job: review(UNREADABLE, 'review') },
  { id: 'D7', family: 'decide', mark: 'none', job: review(UNREADABLE, 'checking') },
  { id: 'O1', family: 'outcome', mark: 'done', job: job({ phase: 'success', world: JOB_WORLD, at: '0,0', total: 3 }) },
  {
    id: 'O2',
    family: 'outcome',
    mark: 'problem',
    job: job({ phase: 'error', world: JOB_WORLD, error: 'The linker refused the upload' })
  },
  {
    id: 'O3',
    family: 'outcome',
    mark: 'problem',
    job: job({ phase: 'error', world: JOB_WORLD, error: `Build failed\n${TSC_ERROR}` })
  }
]

/** §6 — the marks a family may wear. A red alarm on a decision the flow still
 *  permits reads as a failure; a globe on a job that failed reads as nothing at
 *  all. CHOOSE, DECIDE and WAIT carry no disc: their body is the evidence. */
export const FAMILY_MARKS: Record<PublishFamily, PublishMark[]> = {
  choose: ['none'],
  decide: ['none'],
  wait: ['none'],
  outcome: ['done', 'problem'],
  blocked: ['world', 'problem']
}

/** §3 R-A1 — how many controls a family may put on screen at once */
export const FAMILY_CAP: Record<PublishFamily, number> = {
  choose: 1,
  decide: 3,
  wait: 1,
  outcome: 2,
  blocked: 2
}
