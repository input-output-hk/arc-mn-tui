import { useState, useEffect, useRef }                  from 'react';
import { Buffer }                                        from 'buffer';
import { WebSocket }                                     from 'ws';
import * as Rx                                           from 'rxjs';
import * as bip39                                        from 'bip39';
import * as ledger                                       from '@midnight-ntwrk/ledger-v7';
import { WalletFacade }                                  from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet }                                    from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet }                                from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
}                                                        from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { HDWallet, Roles }                               from '@midnight-ntwrk/wallet-sdk-hd';
import { setNetworkId }                                  from '@midnight-ntwrk/midnight-js-network-id';
import type { NetworkConfig }                            from '../types.js';

// Allow the wallet SDK to use WebSocket for GraphQL subscriptions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DustGeneration {
  /** Raw NIGHT units backing DUST generation (÷ 10^6 = displayed NIGHT). */
  designated: bigint;
  /** Raw DUST generated per day (÷ 10^15 = displayed DUST/day). */
  ratePerDay: bigint;
  /** Raw DUST maximum cap across all registered UTXOs (÷ 10^15 = displayed DUST). */
  limit:      bigint;
  /** Latest maxCapReachedAt across all registered UTXOs (when last coin fills). */
  fillTime:   Date;
  /** Number of registered NIGHT UTXOs. */
  numUtxos:   number;
}

export interface WalletBalances {
  shielded:        Record<string, bigint>;
  unshielded:      Record<string, bigint>;
  dust:            bigint;
  dustGeneration:  DustGeneration | null;
}

export interface WalletSyncState {
  synced:   boolean;
  balances: WalletBalances | null;
  error:    string | null;
}

const IDLE: WalletSyncState = { synced: false, balances: null, error: null };

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Convert an http(s) URL to the corresponding ws(s) URL. */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribe to a WalletFacade state observable.
 * When `mnemonic` is undefined (wallet locked) the hook stays idle.
 * Cleans up (stops the wallet) on unmount or when dependencies change.
 */
export function useWalletSync(
  mnemonic: string | undefined,
  network:  NetworkConfig,
  paused  = false,
): WalletSyncState {
  const [state, setState] = useState<WalletSyncState>(IDLE);
  // Track paused via ref so the subscription callback sees the latest value
  // without needing to restart the wallet.
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    if (!mnemonic) {
      setState(IDLE);
      return;
    }

    let cancelled    = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let facade: any  = null;
    let sub: Rx.Subscription | null = null;

    async function start() {
      try {
        setNetworkId(network.name);

        // Derive HD keys from mnemonic
        const seed     = await bip39.mnemonicToSeed(mnemonic!.trim()).then(b => b.toString('hex'));
        const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
        if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
        const result = hdWallet.hdWallet
          .selectAccount(0)
          .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
          .deriveKeysAt(0);
        if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
        hdWallet.hdWallet.clear();
        const keys = result.keys;

        const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
        const dustSecretKey      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
        const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], network.name);

        // Build WebSocket URLs: indexer HTTP → WS + /ws suffix; relay HTTP → WS
        const indexerHttpUrl = network.indexerUrl;
        const indexerWsUrl   = toWsUrl(indexerHttpUrl) + '/ws';
        const relayURL       = new URL(toWsUrl(network.nodeUrl));
        const provingServerUrl = new URL(network.proofServerUrl);

        const walletCfg = {
          networkId:                network.name,
          indexerClientConnection:  { indexerHttpUrl, indexerWsUrl },
          provingServerUrl,
          relayURL,
        };

        const shieldedWallet = ShieldedWallet(walletCfg).startWithSecretKeys(shieldedSecretKeys);

        const unshieldedWallet = UnshieldedWallet({
          networkId:               network.name,
          indexerClientConnection: walletCfg.indexerClientConnection,
          txHistoryStorage:        new InMemoryTransactionHistoryStorage(),
        }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));

        const dustWallet = DustWallet({
          ...walletCfg,
          costParameters: {
            additionalFeeOverhead: 300_000_000_000_000n,
            feeBlocksMargin:       5,
          },
        }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

        facade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
        await facade.start(shieldedSecretKeys, dustSecretKey);

        if (cancelled) { await facade.stop(); return; }

        // Dust protocol parameters — used to compute backing NIGHT from maxCap.
        const dustParams = ledger.LedgerParameters.initialParameters().dust;

        // Throttle to at most one UI update per second, and skip re-renders when
        // nothing visible changed.  Excludes dust.walletBalance() (time-based) and
        // generatedNow (also time-based); uses coin count + pending count instead.
        const stateKey = (s: any): string => {
          const ser = (rec: Record<string, bigint>) =>
            Object.entries(rec as Record<string, bigint>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}:${v}`)
              .join(',');
          const dustKey = `${(s.dust.availableCoins as any[]).length}:${(s.dust.pendingCoins as any[]).length}`;
          return `${String(s.isSynced)}|${ser(s.shielded.balances)}|${ser(s.unshielded.balances)}|${dustKey}`;
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sub = (facade.state() as Rx.Observable<any>).pipe(
          Rx.auditTime(1_000),
          Rx.distinctUntilChanged((prev, curr) => stateKey(prev) === stateKey(curr)),
        ).subscribe({
          next: (s) => {
            if (cancelled || pausedRef.current) return;
            const now   = new Date();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const coins = s.dust.availableCoinsWithFullInfo(now) as any[];
            let limitRaw   = 0n;
            let ratePerDay = 0n;
            let fillTime   = new Date(0);
            for (const coin of coins) {
              limitRaw   += coin.maxCap as bigint;
              ratePerDay += (coin.rate  as bigint) * 86_400n;
              const cap: Date = coin.maxCapReachedAt as Date;
              if (cap > fillTime) fillTime = cap;
            }
            const dustGeneration: DustGeneration | null = coins.length > 0 ? {
              designated: dustParams.nightDustRatio > 0n
                ? limitRaw / dustParams.nightDustRatio
                : 0n,
              ratePerDay,
              limit:    limitRaw,
              fillTime,
              numUtxos: coins.length,
            } : null;
            setState({
              synced:   s.isSynced === true,
              balances: {
                shielded:       s.shielded.balances   as Record<string, bigint>,
                unshielded:     s.unshielded.balances  as Record<string, bigint>,
                dust:           s.dust.walletBalance(now) as bigint,
                dustGeneration,
              },
              error: null,
            });
          },
          error: (e: unknown) => {
            if (!cancelled) setState({
              synced: false, balances: null,
              error: e instanceof Error ? e.message : String(e),
            });
          },
        });
      } catch (e) {
        if (!cancelled) setState({
          synced: false, balances: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    void start();

    return () => {
      cancelled = true;
      sub?.unsubscribe();
      if (facade) void facade.stop();
    };
  }, [mnemonic, network.name, network.indexerUrl, network.nodeUrl, network.proofServerUrl]);

  return state;
}
