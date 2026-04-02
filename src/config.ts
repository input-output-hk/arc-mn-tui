import {readFileSync, writeFileSync} from 'fs';
import {homedir}                     from 'os';
import {join}                        from 'path';
import type {NetworkConfig}          from './types.js';
import {DEFAULT_NETWORK_CONFIG}      from './types.js';

// Persisted config lives in ~/.mn-tui-config.json
const CONFIG_PATH = join(homedir(), '.mn-tui-config.json');

// ---------------------------------------------------------------------------
// Wallet persistence
//
// Addresses are stored on first derivation so the app loads instantly.
// encryptedMnemonic holds the ASCII-armored OpenPGP ciphertext (gpg -c --armor
// compatible) so the user can re-derive on a different network or sign
// transactions after entering their passphrase in-session.
// ---------------------------------------------------------------------------

export interface PersistedWallet {
  name:               string;
  unshielded:         string;
  shielded:           string;
  dust:               string;
  /** ASCII-armored OpenPGP ciphertext of the mnemonic (symmetric, gpg -c). */
  encryptedMnemonic?: string;
}

interface PersistedConfig {
  network:      NetworkConfig;
  wallets:      PersistedWallet[];
  activeWallet: number;
}

const DEFAULTS: PersistedConfig = {
  network:      DEFAULT_NETWORK_CONFIG,
  wallets:      [],
  activeWallet: 0,
};

/** Return true only when all three address fields are plain strings. */
function isValidWallet(w: unknown): w is PersistedWallet {
  if (!w || typeof w !== 'object') return false;
  const {unshielded, shielded, dust, name} = w as Record<string, unknown>;
  return (
    typeof name        === 'string' &&
    typeof unshielded  === 'string' &&
    typeof shielded    === 'string' &&
    typeof dust        === 'string'
  );
}

export function loadConfig(): PersistedConfig {
  try {
    const raw     = readFileSync(CONFIG_PATH, 'utf8');
    const parsed  = JSON.parse(raw) as Partial<PersistedConfig>;
    const merged  = {...DEFAULTS, ...parsed};
    // Drop any wallet entries that have corrupted (non-string) address fields.
    merged.wallets = (merged.wallets ?? []).filter(isValidWallet);
    // Clamp activeWallet index to the valid range.
    if (merged.wallets.length === 0) merged.activeWallet = 0;
    else merged.activeWallet = Math.min(merged.activeWallet, merged.wallets.length - 1);
    return merged;
  } catch {
    return {...DEFAULTS};
  }
}

export function saveConfig(cfg: PersistedConfig): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    // swallow — non-fatal
  }
}
