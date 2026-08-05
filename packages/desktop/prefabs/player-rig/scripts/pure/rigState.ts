// Player vitals as pure data: the rules the Multiplayer Server applies to a
// damage/heal/respawn request, with no SDK and no I/O, so the same functions
// decide the outcome on the server and describe it in a test.
//
// Ported from Dead Surge's lobbyServer combat state. Its four guards are the
// whole reason a client cannot ask its way to invulnerability or to a one-shot
// kill, and they are applied in this order:
//
//   1. dead        — a dead player takes nothing until they respawn
//   2. protection  — a brief window after (re)spawning, so a cluster of zombies
//                    cannot delete a player in the frame they arrive
//   3. cooldown    — one accepted request per kind per window; a flood is
//                    dropped, not queued
//   4. clamp       — the requested amount is floored into 1..maxDamagePerRequest
//
// The request carries an amount because only the client knows what hit it; the
// server decides whether that amount is allowed to matter.
import { stableId } from '../runtime/pure/poolState'

export const RIG_SCHEMA_VERSION = 1

/** Persisted per wallet under the store's Storage key. */
export interface RigVitals {
  schemaVersion: number
  hp: number
  maxHp: number
  lives: number
  deaths: number
  kills: number
}

export interface RigRules {
  maxHp: number
  maxLives: number
  /** Hard ceiling on a single accepted damage request. */
  maxDamagePerRequest: number
  damageCooldownMs: number
  healCooldownMs: number
  spawnProtectionMs: number
  respawnMs: number
}

export const DEFAULT_RIG_RULES: RigRules = {
  maxHp: 100,
  maxLives: 3,
  maxDamagePerRequest: 40,
  damageCooldownMs: 250,
  healCooldownMs: 250,
  spawnProtectionMs: 2000,
  respawnMs: 5000
}

/** Live combat state — server memory only, never persisted (timestamps are per-run). */
export interface RigCombat {
  hp: number
  lives: number
  dead: boolean
  /** 0 when not waiting to respawn. */
  respawnAtMs: number
  protectedUntilMs: number
  lastDamageAtMs: number
  lastHealAtMs: number
}

export type RigVerdict = { ok: true; hp: number; dead: boolean } | { ok: false; reason: string }

export function rulesFrom(partial: Partial<RigRules>): RigRules {
  const maxHp = positiveInt(partial.maxHp, DEFAULT_RIG_RULES.maxHp)
  return {
    maxHp,
    maxLives: positiveInt(partial.maxLives, DEFAULT_RIG_RULES.maxLives),
    maxDamagePerRequest: Math.min(maxHp, positiveInt(partial.maxDamagePerRequest, Math.ceil(maxHp * 0.4))),
    damageCooldownMs: nonNegativeInt(partial.damageCooldownMs, DEFAULT_RIG_RULES.damageCooldownMs),
    healCooldownMs: nonNegativeInt(partial.healCooldownMs, DEFAULT_RIG_RULES.healCooldownMs),
    spawnProtectionMs: nonNegativeInt(partial.spawnProtectionMs, DEFAULT_RIG_RULES.spawnProtectionMs),
    respawnMs: nonNegativeInt(partial.respawnMs, DEFAULT_RIG_RULES.respawnMs)
  }
}

export function defaultVitals(rules: RigRules): RigVitals {
  return {
    schemaVersion: RIG_SCHEMA_VERSION,
    hp: rules.maxHp,
    maxHp: rules.maxHp,
    lives: rules.maxLives,
    deaths: 0,
    kills: 0
  }
}

/** Field-by-field repair of a stored value at the current schema version. */
export function repairVitals(value: Partial<RigVitals>, defaults: RigVitals): RigVitals {
  const maxHp = positiveInt(value.maxHp, defaults.maxHp)
  return {
    schemaVersion: RIG_SCHEMA_VERSION,
    maxHp,
    hp: clampInt(value.hp, 0, maxHp, defaults.hp),
    lives: clampInt(value.lives, 0, Math.max(defaults.lives, 0), defaults.lives),
    deaths: nonNegativeInt(value.deaths, 0),
    kills: nonNegativeInt(value.kills, 0)
  }
}

export function combatFrom(vitals: RigVitals, rules: RigRules, nowMs: number): RigCombat {
  return {
    hp: vitals.hp,
    lives: vitals.lives,
    dead: vitals.hp <= 0,
    respawnAtMs: vitals.hp <= 0 && vitals.lives > 0 ? nowMs + rules.respawnMs : 0,
    protectedUntilMs: nowMs + rules.spawnProtectionMs,
    lastDamageAtMs: 0,
    lastHealAtMs: 0
  }
}

export function isSpawnProtected(combat: RigCombat, nowMs: number): boolean {
  return combat.protectedUntilMs > nowMs
}

export function applyDamage(combat: RigCombat, rules: RigRules, requested: number, nowMs: number): RigVerdict {
  if (combat.dead) return { ok: false, reason: 'dead' }
  if (isSpawnProtected(combat, nowMs)) return { ok: false, reason: 'spawn protection' }
  if (nowMs - combat.lastDamageAtMs < rules.damageCooldownMs) return { ok: false, reason: 'cooldown' }
  const amount = clampInt(requested, 1, rules.maxDamagePerRequest, 1)
  combat.lastDamageAtMs = nowMs
  combat.hp = Math.max(0, combat.hp - amount)
  if (combat.hp === 0) applyDeath(combat, rules, nowMs)
  return { ok: true, hp: combat.hp, dead: combat.dead }
}

export function applyHeal(combat: RigCombat, rules: RigRules, requested: number, nowMs: number): RigVerdict {
  if (combat.dead) return { ok: false, reason: 'dead' }
  if (nowMs - combat.lastHealAtMs < rules.healCooldownMs) return { ok: false, reason: 'cooldown' }
  const amount = clampInt(requested, 1, rules.maxHp, 1)
  combat.lastHealAtMs = nowMs
  combat.hp = Math.min(rules.maxHp, combat.hp + amount)
  return { ok: true, hp: combat.hp, dead: false }
}

function applyDeath(combat: RigCombat, rules: RigRules, nowMs: number): void {
  combat.dead = true
  combat.lives = Math.max(0, combat.lives - 1)
  combat.respawnAtMs = combat.lives > 0 ? nowMs + rules.respawnMs : 0
}

export function respawnDue(combat: RigCombat, nowMs: number): boolean {
  return combat.dead && combat.respawnAtMs > 0 && nowMs >= combat.respawnAtMs
}

export function applyRespawn(combat: RigCombat, rules: RigRules, nowMs: number): RigVerdict {
  if (!combat.dead) return { ok: false, reason: 'alive' }
  if (combat.lives <= 0) return { ok: false, reason: 'out of lives' }
  if (!respawnDue(combat, nowMs)) return { ok: false, reason: 'too early' }
  combat.dead = false
  combat.hp = rules.maxHp
  combat.respawnAtMs = 0
  combat.protectedUntilMs = nowMs + rules.spawnProtectionMs
  combat.lastDamageAtMs = 0
  return { ok: true, hp: combat.hp, dead: false }
}

// The per-player pool keys its clones by instance id, and the ledger broadcasts
// hit points against that same number, so this MUST be the pool's own hash and
// not merely one that looks like it — a formula that differs by one addresses
// half the wallets to the wrong rig. Delegating to stableId is what keeps the
// two ends of that wire equal by construction.
export function addressInstanceId(address: string): number {
  return stableId(address.trim().toLowerCase())
}

/** 0..1, used for the health bar's width and colour. */
export function barFraction(hp: number, maxHp: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return 0
  return Math.max(0, Math.min(1, hp / maxHp))
}

/** Green above two thirds, amber above a third, red below it. */
export function barColor(fraction: number): { r: number; g: number; b: number } {
  if (fraction > 0.66) return { r: 0.24, g: 0.85, b: 0.36 }
  if (fraction > 0.33) return { r: 0.95, g: 0.72, b: 0.2 }
  return { r: 0.9, g: 0.24, b: 0.24 }
}

/** "0x1234…cdef" — the fallback nameplate when a profile has not arrived. */
export function shortAddress(address: string): string {
  const text = address.trim()
  if (text.length <= 11) return text
  return `${text.slice(0, 6)}…${text.slice(-4)}`
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(min, Math.min(max, fallback))
  return Math.max(min, Math.min(max, Math.floor(value)))
}
