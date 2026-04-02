import {readFileSync, writeFileSync} from 'fs';
import {homedir}                     from 'os';
import {join}                        from 'path';
import type {NetworkConfig}          from './types.js';
import {DEFAULT_NETWORK_CONFIG}      from './types.js';

// Persisted config lives in ~/.mn-tui-config.json
const CONFIG_PATH = join(homedir(), '.mn-tui-config.json');

interface PersistedConfig {
  network: NetworkConfig;
}

export function loadConfig(): PersistedConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return {network: DEFAULT_NETWORK_CONFIG};
  }
}

export function saveConfig(cfg: PersistedConfig): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    // swallow — non-fatal
  }
}
