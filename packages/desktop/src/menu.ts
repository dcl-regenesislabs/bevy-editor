// The native application menu. Rebuilt whenever the recents list changes.
import { app, Menu } from 'electron'

export interface MenuActions {
  recentProjects: string[]
  onHome: () => void
  onPickProject: () => void
  onOpenProject: (dir: string) => void
  onCheckForUpdates: () => void
}

export function buildMenu(actions: MenuActions): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    // A custom app menu, not role:'appMenu': that one binds Quit to ⌘Q, which is
    // the Select tool now.
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              { role: 'about' as const },
              { label: 'Check for Updates…', click: actions.onCheckForUpdates },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { type: 'separator' as const },
              { label: 'Quit', accelerator: 'CmdOrCtrl+Shift+Q', role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Scene',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: actions.onHome },
        { label: 'Open Scene Folder…', accelerator: 'CmdOrCtrl+O', click: actions.onPickProject },
        { type: 'separator' },
        ...actions.recentProjects.map((p) => ({ label: p, click: () => actions.onOpenProject(p) })),
        { type: 'separator' },
        // macOS has this in the app menu; give Windows/Linux a home for it too
        ...(process.platform !== 'darwin'
          ? [{ label: 'Check for Updates…', click: actions.onCheckForUpdates }, { type: 'separator' as const }]
          : []),
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' as const },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Shift+Q', role: 'quit' as const }
      ]
    },
    // NOT role:'editMenu' — its Undo/Redo items bind ⌘Z/⌘⇧Z and swallow them
    // before the page sees them. Cut/copy/paste keep their roles so typing in a
    // field still behaves normally.
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
