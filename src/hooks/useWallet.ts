import {useState, useCallback}         from 'react';
import type {WalletEntry, TokenBalance, SendParams, TxStatus} from '../types.js';
import {loadConfig, saveConfig}        from '../config.js';
import type {PersistedWallet}          from '../config.js';
import {decryptMnemonic}               from '../keys.js';

// ---------------------------------------------------------------------------
// Stub balances — replaced when real wallet sync is implemented
// ---------------------------------------------------------------------------

const STUB_BALANCES: TokenBalance[] = [
  {symbol: 'NIGHT', kind: 'NIGHT', amount: 0n, decimals: 6},
  {symbol: 'DUST',  kind: 'DUST',  amount: 0n, decimals: 6},
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWallet() {
  const [persisted,    setPersisted]    = useState<PersistedWallet[]>(
    () => loadConfig().wallets ?? [],
  );
  const [activeIndex,  setActiveIdx]    = useState<number>(() => {
    const cfg = loadConfig();
    const len = cfg.wallets?.length ?? 0;
    return len === 0 ? 0 : Math.max(0, Math.min(cfg.activeWallet ?? 0, len - 1));
  });
  const [txStatus,     setTxStatus]     = useState<TxStatus>({stage: 'idle'});

  // Session-only mnemonic cache: index → plaintext mnemonic.
  // Never persisted; cleared when wallets are removed (indices shift).
  const [mnemonicCache, setMnemonicCache] = useState<Map<number, string>>(() => new Map());

  // Derived view — no source metadata exposed outside this hook
  const wallets: WalletEntry[] = persisted.map(p => ({
    name: p.name, unshielded: p.unshielded, shielded: p.shielded, dust: p.dust,
  }));

  const activeWallet = wallets[activeIndex] ?? null;

  // ---- mnemonic cache helpers ---------------------------------------------

  const isCached  = useCallback((idx: number) => mnemonicCache.has(idx), [mnemonicCache]);
  const getMnemonic = useCallback((idx: number) => mnemonicCache.get(idx), [mnemonicCache]);

  /** Decrypt the wallet at idx and store the plaintext in the session cache. */
  const unlockWallet = useCallback(async (idx: number, passphrase: string): Promise<void> => {
    const pw = persisted[idx];
    if (!pw?.encryptedMnemonic) throw new Error('Wallet has no encrypted mnemonic');
    const mnemonic = await decryptMnemonic(pw.encryptedMnemonic, passphrase);
    setMnemonicCache(prev => new Map(prev).set(idx, mnemonic));
  }, [persisted]);

  // ---- mutations ---------------------------------------------------------

  const addWallet = useCallback((pw: PersistedWallet, plainMnemonic?: string) => {
    setPersisted(prev => {
      const next    = [...prev, pw];
      const nextIdx = next.length - 1;
      if (plainMnemonic !== undefined) {
        setMnemonicCache(cache => new Map(cache).set(nextIdx, plainMnemonic));
      }
      setActiveIdx(nextIdx);
      const cfg = loadConfig();
      saveConfig({...cfg, wallets: next, activeWallet: nextIdx});
      return next;
    });
  }, []);

  const removeWallet = useCallback((idx: number) => {
    // Clear the entire cache because removing a wallet shifts all subsequent
    // indices, making any cached entries for those indices stale.
    setMnemonicCache(new Map());
    setPersisted(prev => {
      const next    = prev.filter((_, i) => i !== idx);
      const nextIdx = Math.max(0, Math.min(activeIndex, next.length - 1));
      setActiveIdx(nextIdx);
      const cfg = loadConfig();
      saveConfig({...cfg, wallets: next, activeWallet: nextIdx});
      return next;
    });
  }, [activeIndex]);

  const setActiveIndex = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, wallets.length - 1));
    setActiveIdx(clamped);
    const cfg = loadConfig();
    saveConfig({...cfg, activeWallet: clamped});
  }, [wallets.length]);

  // ---- send (stub) -------------------------------------------------------

  const send = useCallback(async (_params: SendParams) => {
    setTxStatus({stage: 'building'});
    await delay(500);
    setTxStatus({stage: 'proving'});
    await delay(1_500);
    setTxStatus({stage: 'submitting'});
    await delay(500);
    setTxStatus({stage: 'pending', txHash: '0xSTUB_TX_HASH'});
  }, []);

  // ---- legacy wallet object (for BalanceTable, Dashboard) ----------------

  const wallet = {
    connected: activeWallet !== null,
    address:   activeWallet?.unshielded ?? '',
    balances:  STUB_BALANCES,
  };

  return {
    wallets, persisted, activeIndex, activeWallet,
    addWallet, removeWallet, setActiveIndex,
    isCached, getMnemonic, unlockWallet,
    wallet, txStatus, send,
  };
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
