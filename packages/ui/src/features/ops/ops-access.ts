// Visibility gate for the hidden ops section: shown only to fleet operators.
// This is UI gating only — the real gate is the multiplayer-server ADMINS
// allowlist on the signed /debug/stats request.
const OPS_ADMINS = new Set(['0xb8c4df381c6c305758f806c3aa71f37aabbcbd92'])

export function canSeeOps(wallet: string | null): boolean {
  return wallet !== null && OPS_ADMINS.has(wallet.toLowerCase())
}
