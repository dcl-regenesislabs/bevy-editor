// Contract for curated per-component inspector views. A view replaces the
// generic SchemaEditor for one component; it stages edits through the same
// field-edit/commit machinery so writes stay optimistic + bus-mirrored.
import type { ComponentSchema } from '../../../../scene/src/schema'

export interface ComponentViewProps {
  /** componentKey(entityId, name) — the fieldEdits/editStatus key */
  cKey: string
  entityId: string
  name: string
  /** current component value from the snapshot */
  value: unknown
  /** engine schema (may still be loading) */
  schema: ComponentSchema | undefined
  /** rebuild-from-schema + write (uiApplyFromSchema) — call on field commit */
  commit: () => void
  /** replace the whole component value with this JSON (uiSetComponentValue) */
  apply: (json: string) => void
}

export type ComponentView = (props: ComponentViewProps) => JSX.Element
