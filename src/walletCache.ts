import {readFileSync, writeFileSync, mkdirSync} from 'fs';
import {homedir} from 'os';
import {join}    from 'path';

// XDG-compliant cache directory: $XDG_CACHE_HOME/mn-tui or ~/.cache/mn-tui
const CACHE_DIR = join(
  process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'),
  'mn-tui',
);

type WalletType = 'shielded' | 'unshielded' | 'dust';

function statePath(network: string, address: string, type: WalletType): string {
  return join(CACHE_DIR, network, `${address}-${type}.state`);
}

/**
 * Load a previously serialised wallet state from disk.
 * Returns null on any error (file missing, unreadable, etc.).
 */
export function loadState(network: string, address: string, type: WalletType): string | null {
  try {
    return readFileSync(statePath(network, address, type), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Persist a serialised wallet state to disk.
 * Creates the network subdirectory if needed; swallows all errors (non-fatal).
 */
export function saveState(network: string, address: string, type: WalletType, state: string): void {
  try {
    mkdirSync(join(CACHE_DIR, network), {recursive: true});
    writeFileSync(statePath(network, address, type), state, 'utf8');
  } catch {
    // swallow — cache write failure is non-fatal
  }
}
