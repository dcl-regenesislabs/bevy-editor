// One component per UI role — the single source of truth for the STRICT RULE
// that a role may not have two implementations. Enforced by ds-contract.test.ts.
//
// `classes` are the class tokens that belong to the role's implementation. They
// may only appear inside src/ds/; a feature that writes one by hand is building
// a second implementation of a role that already has one.
export interface CanonicalRole {
  /** the one component that serves this role */
  component: string
  /** class tokens owned by that component — banned in markup outside src/ds/ */
  classes: string[]
}

export const CANONICAL_ROLES: Record<string, CanonicalRole> = {
  'single-select picker': { component: 'Select', classes: ['eui-ds-select', 'eui-ds-select-field', 'eui-select'] },
  'multi-select picker': { component: 'MultiSelect', classes: ['eui-ms-btn', 'eui-ms-pop', 'eui-ms-row'] },
  'floating option surface': { component: 'Popover', classes: ['eui-ds-pop', 'eui-ds-pop-row', 'eui-ds-dd-menu', 'eui-ds-select-list'] },
  'boolean switch': { component: 'Toggle', classes: ['eui-ds-toggle', 'eui-toggle'] },
  'labelled boolean': { component: 'Checkbox', classes: ['eui-ds-check', 'eui-check'] },
  'segmented control': { component: 'Segmented', classes: ['eui-seg', 'eui-seg-btn'] },
  'slider': { component: 'Slider', classes: ['eui-ds-slider'] },
  'status chip': { component: 'Chip', classes: ['eui-ds-chip'] },
  'modal dialog': { component: 'Modal', classes: ['eui-modal'] },
  'collapsible section': { component: 'Shelf', classes: ['eui-shelf', 'eui-shelf-head', 'eui-shelf-note'] },
  'panel notice': { component: 'Notice', classes: ['eui-ds-notice'] },
  'pointer-positioned menu': { component: 'ContextMenu', classes: [] }
}

/** Exports from ds/index.tsx that are not role components (helpers, layout, types). */
export const UNROLED = [
  'Button', 'IconButton', 'LinkButton', 'ControlButton', 'ConfirmButton',
  'SelectTrigger', 'TextInput', 'NumberField', 'TextArea', 'SearchField', 'CopyField',
  'ColorSwatch', 'FieldLabel', 'IdBadge', 'Panel', 'GroupLabel', 'PropRow', 'MenuItem',
  'Tooltip', 'Spinner', 'Toast', 'AutoSaveChip', 'Pager', 'PanelState',
  'useOutsideClose', 'useLoad', 'usePageClamp', 'copyText', 'TOGGLE_SIZES', 'NOTICE_TONES'
]
