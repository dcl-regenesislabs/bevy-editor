// Our own engine host page (engine.html), which boots the upstream engine via
// its boot contract (/engine/boot.js + __bevyLaunch). The engine package's root
// index.html is the full Decentraland React HUD now — not loadable as a bare
// engine — so the editor owns the boot page.
// Leave the current scene for the picker. Stops the project's dev server (and
// its auth-server child) first via the shell so it doesn't linger, then
// navigates. Falls back to a plain navigation in-page (no shell).
export function backToProjects(): void {
  const shell = window.editorShell
  if (shell?.closeProject !== undefined) {
    void shell.closeProject().finally(() => window.location.assign('/editor-app.html'))
  } else {
    window.location.assign('/editor-app.html')
  }
}
