// One source of truth for "which key is the modifier here" — the platform test
// and the ⌘/Ctrl glyphs used to be re-derived in every module that needed them,
// with two different platform sniffs that disagreed on edge cases.
//
// Two matchers, and the difference matters:
//   isMod        — either ⌘ or Ctrl. For chords we accept both ways round on
//                  every platform (⌘/Ctrl+click to pick, ⌘/Ctrl+Z).
//   isPrimaryMod — the platform's own modifier, and only that one. For chords
//                  where the other key already means something: on a Mac, Ctrl+P
//                  is caret-up in text fields and CodeMirror, so a ⌘P handler
//                  that also fired on Ctrl+P would steal it.
//
// navigator.platform is deprecated but still the only synchronous signal that
// works in every surface we run in (renderer, engine iframe); userAgentData is
// preferred when present.
const platform =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
  navigator.platform

export const isMac = platform.toLowerCase().includes('mac')

// Display glyphs. Mac users read ⌘⌥⇧; everyone else reads the words.
export const MOD = isMac ? '⌘' : 'Ctrl'
export const ALT = isMac ? '⌥' : 'Alt'
export const SHIFT = isMac ? '⇧' : 'Shift'

// Format a combo for display: keyCombo(MOD, SHIFT, 'Z') → '⌘⇧Z' / 'Ctrl+Shift+Z'.
export const keyCombo = (...parts: string[]): string => parts.join(isMac ? '' : '+')

// Structural, so the same matcher takes native events and React's synthetic ones.
type ModifierEvent = { metaKey: boolean; ctrlKey: boolean }

export const isMod = (e: ModifierEvent): boolean => e.metaKey || e.ctrlKey

export const isPrimaryMod = (e: ModifierEvent): boolean =>
  isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
