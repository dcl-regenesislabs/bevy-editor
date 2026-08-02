import { useState, type ReactNode } from 'react'
import type { ComponentView, ComponentViewProps } from './types'
import { state, type Snapshot } from '../../../../scene/src/state'
import { entityName } from '../../../../scene/src/custom-components'
import { useStore } from '../../store'
import { IconButton, Select, TextInput, Toggle } from '../../ds'
import { IconPlus, IconTrash } from '../../icons'
import {
  ACTIONS_COMPONENT,
  REWARDS_COMPONENT,
  VIDEO_PLAYER_COMPONENT,
  actionNames,
  adminToolsJson,
  entitiesWithComponent,
  normalizeAdminTools,
  suggestedName,
  type AdminToolsValue,
  type EntityOption,
  type EntityRef,
  type SmartItemRef
} from './admin-tools'

export const AdminToolsView: ComponentView = (props: ComponentViewProps): JSX.Element => {
  const snapshot = useStore(() => state.snapshot)
  const value = normalizeAdminTools(props.value)
  const apply = (next: AdminToolsValue): void => props.apply(adminToolsJson(next))

  const options = (component: string): EntityOption[] =>
    entitiesWithComponent(
      snapshot,
      component,
      (id) => entityName(snapshot as Snapshot, id),
      props.entityId
    )

  return (
    <div className="eui-admin-view">
      <Section title="Who is an admin" defaultOpen>
        <Row label="access" tip="PUBLIC lets anyone with the panel open it; PRIVATE limits it to the allow list.">
          <Select
            compact
            value={value.adminPermissions}
            options={[
              { value: 'PUBLIC', label: 'Public' },
              { value: 'PRIVATE', label: 'Private' }
            ]}
            onChange={(next) =>
              apply({
                ...value,
                adminPermissions: next === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
              })
            }
            aria-label="admin access"
          />
        </Row>
        <ToggleRow
          label="me"
          tip="The scene's deployer is always an admin."
          checked={value.authorizedAdminUsers.me}
          onChange={(me) =>
            apply({ ...value, authorizedAdminUsers: { ...value.authorizedAdminUsers, me } })
          }
        />
        <ToggleRow
          label="scene owners"
          tip="Everyone with publish permissions on this land."
          checked={value.authorizedAdminUsers.sceneOwners}
          onChange={(sceneOwners) =>
            apply({
              ...value,
              authorizedAdminUsers: { ...value.authorizedAdminUsers, sceneOwners }
            })
          }
        />
        <ToggleRow
          label="allow list"
          tip="Extra wallet addresses listed below."
          checked={value.authorizedAdminUsers.allowList}
          onChange={(allowList) =>
            apply({ ...value, authorizedAdminUsers: { ...value.authorizedAdminUsers, allowList } })
          }
        />
        {value.authorizedAdminUsers.allowList && (
          <AllowList
            addresses={value.authorizedAdminUsers.adminAllowList}
            onChange={(adminAllowList) =>
              apply({
                ...value,
                authorizedAdminUsers: { ...value.authorizedAdminUsers, adminAllowList }
              })
            }
          />
        )}
      </Section>

      <Section title="Moderation" enabled={value.moderationControl.isEnabled}>
        <ToggleRow
          label="enabled"
          tip="Shows the moderation tab in the in-world panel."
          checked={value.moderationControl.isEnabled}
          onChange={(isEnabled) =>
            apply({ ...value, moderationControl: { ...value.moderationControl, isEnabled } })
          }
        />
        <Row label="kick to" tip="Where a kicked player is moved inside the scene.">
          <div className="eui-admin-vec">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <input
                key={axis}
                className="eui-num"
                type="number"
                aria-label={`kick ${axis}`}
                defaultValue={value.moderationControl.kickCoordinates[axis]}
                onBlur={(e) => {
                  const parsed = parseFloat(e.target.value)
                  if (Number.isNaN(parsed)) return
                  apply({
                    ...value,
                    moderationControl: {
                      ...value.moderationControl,
                      kickCoordinates: {
                        ...value.moderationControl.kickCoordinates,
                        [axis]: parsed
                      }
                    }
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                }}
              />
            ))}
          </div>
        </Row>
        <ToggleRow
          label="non-owners manage admins"
          tip="Let allow-listed admins add and remove other admins."
          checked={value.moderationControl.allowNonOwnersManageAdminAllowList}
          onChange={(allowNonOwnersManageAdminAllowList) =>
            apply({
              ...value,
              moderationControl: {
                ...value.moderationControl,
                allowNonOwnersManageAdminAllowList
              }
            })
          }
        />
      </Section>

      <Section title="Text announcements" enabled={value.textAnnouncementControl.isEnabled}>
        <ToggleRow
          label="enabled"
          checked={value.textAnnouncementControl.isEnabled}
          onChange={(isEnabled) =>
            apply({
              ...value,
              textAnnouncementControl: { ...value.textAnnouncementControl, isEnabled }
            })
          }
        />
        <ToggleRow
          label="play a sound"
          tip="Chime on every announcement."
          checked={value.textAnnouncementControl.playSoundOnEachAnnouncement}
          onChange={(playSoundOnEachAnnouncement) =>
            apply({
              ...value,
              textAnnouncementControl: {
                ...value.textAnnouncementControl,
                playSoundOnEachAnnouncement
              }
            })
          }
        />
        <ToggleRow
          label="show the author"
          checked={value.textAnnouncementControl.showAuthorOnEachAnnouncement}
          onChange={(showAuthorOnEachAnnouncement) =>
            apply({
              ...value,
              textAnnouncementControl: {
                ...value.textAnnouncementControl,
                showAuthorOnEachAnnouncement
              }
            })
          }
        />
      </Section>

      <Section title="Video control" enabled={value.videoControl.isEnabled}>
        <ToggleRow
          label="enabled"
          checked={value.videoControl.isEnabled}
          onChange={(isEnabled) =>
            apply({ ...value, videoControl: { ...value.videoControl, isEnabled } })
          }
        />
        <ToggleRow
          label="mute screens"
          tip="Screens play silently for everyone."
          checked={value.videoControl.disableVideoPlayersSound}
          onChange={(disableVideoPlayersSound) =>
            apply({ ...value, videoControl: { ...value.videoControl, disableVideoPlayersSound } })
          }
        />
        <ToggleRow
          label="show the author"
          checked={value.videoControl.showAuthorOnVideoPlayers}
          onChange={(showAuthorOnVideoPlayers) =>
            apply({ ...value, videoControl: { ...value.videoControl, showAuthorOnVideoPlayers } })
          }
        />
        <ToggleRow
          label="link all screens"
          tip="One control drives every screen at once."
          checked={value.videoControl.linkAllVideoPlayers}
          onChange={(linkAllVideoPlayers) =>
            apply({ ...value, videoControl: { ...value.videoControl, linkAllVideoPlayers } })
          }
        />
        <RefList
          items={value.videoControl.videoPlayers}
          options={options(VIDEO_PLAYER_COMPONENT)}
          prefix="Screen"
          addLabel="Add video screen"
          emptyHint="No entity in this scene has a VideoPlayer component yet."
          onChange={(videoPlayers) =>
            apply({ ...value, videoControl: { ...value.videoControl, videoPlayers } })
          }
        />
      </Section>

      <Section title="Smart item actions" enabled={value.smartItemsControl.isEnabled}>
        <ToggleRow
          label="enabled"
          checked={value.smartItemsControl.isEnabled}
          onChange={(isEnabled) =>
            apply({ ...value, smartItemsControl: { ...value.smartItemsControl, isEnabled } })
          }
        />
        <ToggleRow
          label="link all items"
          tip="One control fires the default action on every linked item."
          checked={value.smartItemsControl.linkAllSmartItems}
          onChange={(linkAllSmartItems) =>
            apply({ ...value, smartItemsControl: { ...value.smartItemsControl, linkAllSmartItems } })
          }
        />
        <SmartItemList
          items={value.smartItemsControl.smartItems}
          options={options(ACTIONS_COMPONENT)}
          snapshot={snapshot}
          onChange={(smartItems) =>
            apply({ ...value, smartItemsControl: { ...value.smartItemsControl, smartItems } })
          }
        />
      </Section>

      <Section title="Rewards" enabled={value.rewardsControl.isEnabled}>
        <ToggleRow
          label="enabled"
          checked={value.rewardsControl.isEnabled}
          onChange={(isEnabled) =>
            apply({ ...value, rewardsControl: { ...value.rewardsControl, isEnabled } })
          }
        />
        <RefList
          items={value.rewardsControl.rewardItems}
          options={options(REWARDS_COMPONENT)}
          prefix="Reward"
          addLabel="Add reward dispenser"
          emptyHint="No entity in this scene has a Rewards component yet."
          onChange={(rewardItems) =>
            apply({ ...value, rewardsControl: { ...value.rewardsControl, rewardItems } })
          }
        />
      </Section>
    </div>
  )
}

function Section(props: {
  title: string
  defaultOpen?: boolean
  enabled?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(props.defaultOpen === true)
  return (
    <div className="eui-admin-section">
      <button
        className="eui-admin-section-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`chev ${open ? 'open' : ''}`}>▸</span>
        <span className="title">{props.title}</span>
        {props.enabled === false && <span className="off">off</span>}
      </button>
      {open && <div className="eui-admin-section-body">{props.children}</div>}
    </div>
  )
}

function Row(props: { label: string; tip?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="eui-prop">
      <span className="plabel" data-tip={props.tip}>
        {props.label}
      </span>
      <div className="pvalue">{props.children}</div>
    </div>
  )
}

function ToggleRow(props: {
  label: string
  tip?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <Row label={props.label} tip={props.tip}>
      <Toggle size="sm" checked={props.checked} onChange={props.onChange} aria-label={props.label} />
    </Row>
  )
}

function AllowList(props: {
  addresses: string[]
  onChange: (addresses: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const trimmed = draft.trim().toLowerCase()
    if (trimmed === '' || props.addresses.includes(trimmed)) return
    props.onChange([...props.addresses, trimmed])
    setDraft('')
  }
  return (
    <div className="eui-admin-list">
      {props.addresses.map((address, i) => (
        <div key={`${address}:${i}`} className="eui-admin-item">
          <span className="eui-admin-addr" data-tip={address}>
            {address}
          </span>
          <IconButton
            tip="Remove"
            style={{ width: 20, height: 20 }}
            onClick={() => props.onChange(props.addresses.filter((_, j) => j !== i))}
          >
            <IconTrash />
          </IconButton>
        </div>
      ))}
      <div className="eui-admin-add">
        <TextInput
          placeholder="0x… wallet address"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <IconButton tip="Add address" style={{ width: 22, height: 22 }} onClick={add}>
          <IconPlus />
        </IconButton>
      </div>
    </div>
  )
}

function EntitySelect(props: {
  value: number
  options: EntityOption[]
  onChange: (id: number) => void
}): JSX.Element {
  const options = props.options.map((option) => ({
    value: String(option.id),
    label: option.label
  }))
  if (!options.some((option) => option.value === String(props.value))) {
    options.unshift({ value: String(props.value), label: `#${props.value}` })
  }
  return (
    <Select
      density="compact"
      className="eui-admin-select"
      value={String(props.value)}
      options={options}
      onChange={(next) => props.onChange(Number(next))}
      aria-label="entity"
    />
  )
}

function firstFreeOption(options: EntityOption[], items: EntityRef[]): EntityOption | undefined {
  return options.find((option) => !items.some((item) => item.entity === option.id))
}

function replaceAt<T extends object>(items: T[], index: number, patch: Partial<T>): T[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item))
}

function RefRow(props: {
  entity: number
  customName: string
  options: EntityOption[]
  onEntity: (entity: number) => void
  onName: (customName: string) => void
  onRemove: () => void
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="eui-admin-item column">
      <div className="eui-admin-item-row">
        <EntitySelect value={props.entity} options={props.options} onChange={props.onEntity} />
        <IconButton tip="Remove" style={{ width: 20, height: 20 }} onClick={props.onRemove}>
          <IconTrash />
        </IconButton>
      </div>
      <TextInput
        placeholder="label shown to the admin"
        defaultValue={props.customName}
        onBlur={(e) => {
          if (e.target.value !== props.customName) props.onName(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {props.children}
    </div>
  )
}

function ListFooter(props: {
  options: EntityOption[]
  emptyHint: string
  addLabel: string
  onAdd: () => void
}): JSX.Element {
  if (props.options.length === 0) return <div className="eui-admin-hint">{props.emptyHint}</div>
  return (
    <button className="eui-link eui-admin-add-btn" onClick={props.onAdd}>
      + {props.addLabel}
    </button>
  )
}

function RefList(props: {
  items: EntityRef[]
  options: EntityOption[]
  prefix: string
  addLabel: string
  emptyHint: string
  onChange: (items: EntityRef[]) => void
}): JSX.Element {
  const { items, options, onChange } = props
  const add = (): void => {
    const free = firstFreeOption(options, items)
    onChange([
      ...items,
      {
        entity: free?.id ?? 0,
        customName: suggestedName(free, items.length, props.prefix)
      }
    ])
  }
  return (
    <div className="eui-admin-list">
      {items.map((item, i) => (
        <RefRow
          key={`${item.entity}:${i}`}
          entity={item.entity}
          customName={item.customName}
          options={options}
          onEntity={(entity) => onChange(replaceAt(items, i, { entity }))}
          onName={(customName) => onChange(replaceAt(items, i, { customName }))}
          onRemove={() => onChange(items.filter((_, j) => j !== i))}
        />
      ))}
      <ListFooter
        options={options}
        emptyHint={props.emptyHint}
        addLabel={props.addLabel}
        onAdd={add}
      />
    </div>
  )
}

function SmartItemList(props: {
  items: SmartItemRef[]
  options: EntityOption[]
  snapshot: Record<string, Record<string, unknown>>
  onChange: (items: SmartItemRef[]) => void
}): JSX.Element {
  const { items, options, snapshot, onChange } = props
  const add = (): void => {
    const free = firstFreeOption(options, items)
    const names = actionNames(snapshot[String(free?.id ?? '')])
    onChange([
      ...items,
      {
        entity: free?.id ?? 0,
        customName: suggestedName(free, items.length, 'Smart item'),
        defaultAction: names[0] ?? ''
      }
    ])
  }
  return (
    <div className="eui-admin-list">
      {items.map((item, i) => {
        const names = actionNames(snapshot[String(item.entity)])
        const actionOptions = names.map((name) => ({ value: name, label: name }))
        if (item.defaultAction !== '' && !names.includes(item.defaultAction)) {
          actionOptions.unshift({ value: item.defaultAction, label: `${item.defaultAction} (missing)` })
        }
        return (
          <RefRow
            key={`${item.entity}:${i}`}
            entity={item.entity}
            customName={item.customName}
            options={options}
            onEntity={(entity) =>
              onChange(
                replaceAt(items, i, {
                  entity,
                  defaultAction: actionNames(snapshot[String(entity)])[0] ?? ''
                })
              )
            }
            onName={(customName) => onChange(replaceAt(items, i, { customName }))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          >
            {actionOptions.length === 0 ? (
              <div className="eui-admin-hint">That entity has no actions yet.</div>
            ) : (
              <Select
                compact
                value={item.defaultAction}
                options={actionOptions}
                onChange={(defaultAction) => onChange(replaceAt(items, i, { defaultAction }))}
                aria-label="default action"
              />
            )}
          </RefRow>
        )
      })}
      <ListFooter
        options={options}
        emptyHint="No entity in this scene has smart-item actions yet."
        addLabel="Add smart item"
        onAdd={add}
      />
    </div>
  )
}
