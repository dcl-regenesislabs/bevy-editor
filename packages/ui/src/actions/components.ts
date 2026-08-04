// Component reads/writes on an entity: the inspector's whole mutation surface.
import { setEditStatus } from '@scene/state'
import {
  setComponentValue,
  applyStructuredEdits,
  addComponent,
  deleteComponent,
  writeComponent
} from '@scene/inspector'
import { buildFromSchema, type ComponentSchema } from '@scene/schema'
import { sendToScene } from '../engine/bus'
import { run } from './run'

export const uiSetComponentValue = async (
  key: string,
  entityId: string,
  name: string,
  json: string
): Promise<void> => {
  await run(setComponentValue(key, entityId, name, json))
}

export const uiApplyStructuredEdits = async (
  key: string,
  entityId: string,
  name: string,
  value: unknown
): Promise<void> => {
  await run(applyStructuredEdits(key, entityId, name, value))
}

// schema-driven apply: rebuild the full component from schema + edits, then write
export const uiApplyFromSchema = async (
  key: string,
  entityId: string,
  name: string,
  schema: ComponentSchema,
  value: unknown
): Promise<void> => {
  const built = buildFromSchema(key, schema, value)
  if (!built.ok) {
    setEditStatus(key, built.error)
    return
  }
  await run(setComponentValue(key, entityId, name, built.json))
}

export const uiAddComponent = async (entityId: string, name: string): Promise<void> => {
  await run(addComponent(entityId, name))
}

export const uiDeleteComponent = (entityId: string, name: string): void => {
  deleteComponent(entityId, name)
  void sendToScene({ type: 'refresh' })
}

// Creator Hub's lock / hide flags. We honour them (a locked entity can't be
// picked or dragged, a hidden one isn't drawn), so the editor has to be able to
// clear them too — otherwise a project made there arrives with entities that
// can never be touched again. Both are editor state, excluded from the composite.
export const uiSetEntityFlag = async (
  id: string,
  flag: 'inspector::Lock' | 'inspector::Hide',
  on: boolean
): Promise<void> => {
  await run(writeComponent(id, flag, JSON.stringify({ value: on })))
}
