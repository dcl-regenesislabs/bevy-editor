// CLI output reaches the renderer with its colour codes intact, and a line can
// arrive with the leading ESC byte already lost in transport — so the escape is
// optional in the pattern. One implementation, shared: the editor's scene health
// and the publish flow both render raw sdk-commands output.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b?\[[0-9;]*m/g

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '')
}
