// Direct console-command transport to the bevy engine. The engine lives either
// in this window (in-page editor) or in a same-origin iframe (host app) — the
// host calls setEngineWindow(iframe.contentWindow) and everything else is
// identical. This module is the single RPC seam between the editor UI and the
// engine.

interface EngineWindow extends Window {
  engine_console_command_args?: (cmd: string, args: string[]) => Promise<string>
  engine_console_command?: (line: string) => Promise<string>
  engine?: Record<string, (...args: unknown[]) => Promise<unknown>>
}

declare global {
  interface Window {
    engine_console_command_args?: (cmd: string, args: string[]) => Promise<string>
    engine_console_command?: (line: string) => Promise<string>
    engine?: Record<string, (...args: unknown[]) => Promise<unknown>>
  }
}

let engine: EngineWindow = window

export function setEngineWindow(w: Window): void {
  engine = w as EngineWindow
}

export async function consoleCommand(cmd: string, args: string[] = []): Promise<string> {
  if (engine.engine_console_command_args !== undefined) {
    return await engine.engine_console_command_args(cmd, args)
  }
  if (engine.engine_console_command !== undefined) {
    return await engine.engine_console_command([cmd, ...args].join(' '))
  }
  throw new Error('engine console API not available yet')
}

export function engineReady(): boolean {
  try {
    return (
      engine.engine_console_command_args !== undefined ||
      engine.engine_console_command !== undefined
    )
  } catch {
    return false
  }
}
