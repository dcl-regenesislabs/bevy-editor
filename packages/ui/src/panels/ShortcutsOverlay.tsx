import { SHORTCUT_GROUPS } from '../shortcuts'
import { Modal } from './Dialogs'

// The `?` cheatsheet. Open/closed is plain React state in App; generated from the
// same SHORTCUT_GROUPS the dispatcher uses, so the list can never drift from
// behavior. No scene/engine state involved — pure UI chrome.
export function ShortcutsOverlay(props: { onClose: () => void }): JSX.Element {
  const close = props.onClose
  return (
    <Modal title="Keyboard shortcuts" onClose={close}>
      <div className="eui-shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="eui-shortcuts-group">
            <div className="eui-shortcuts-head">{group.title}</div>
            {group.items.map((s) => (
              <div key={s.combo + s.label} className="eui-shortcut-row">
                <span className="eui-shortcut-label">{s.label}</span>
                <kbd className="eui-kbd">{s.combo}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="eui-shortcuts-foot">
        Press <kbd className="eui-kbd">?</kbd> any time to toggle this list.
      </div>
    </Modal>
  )
}
