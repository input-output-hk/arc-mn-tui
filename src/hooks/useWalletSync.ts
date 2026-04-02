import { useState, useEffect, useRef, useCallback }     from 'react';
import * as path                                         from 'node:path';
import * as fs                                           from 'node:fs';
import { pathToFileURL, fileURLToPath }                  from 'node:url';
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
import { deployContract, findDeployedContract }          from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract }                              from '@midnight-ntwrk/compact-js';
import { NodeZkConfigProvider }                          from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider }                       from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider }                     from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider }                     from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { NetworkConfig, TxStatus }                  from '../types.js';
import { loadState, saveState, deleteState, CACHE_DIR }  from '../walletCache.js';
import { logger }                                       from '../logger.js';

// Allow the wallet SDK to use WebSocket for GraphQL subscriptions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

// Workaround for ledger-v7 7.0.0/7.0.1 bug: MerkleTree::collapse panics on non-empty
// trees when producing shielded outputs. See: https://github.com/geofflittle/tryapply-crash-repro
const _origTryApply = ledger.ZswapChainState.prototype.tryApply;
ledger.ZswapChainState.prototype.tryApply = function (...args: unknown[]) {
  try {
    return _origTryApply.apply(this, args as any);
  } catch {
    return [this, new Map()];
  }
};

/** Built-in fungible-token managed/ directory, resolved relative to this module. */
const BUILTIN_FT_MANAGED = fileURLToPath(
  new URL('../../contracts/managed/fungible-token', import.meta.url));

export interface MintResult {
  txHash:    string;
  tokenType: string;
}

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

/** A single output within a transfer transaction. */
export interface SendRequest {
  type:    'shielded' | 'unshielded';
  /** Hex token ID; NIGHT = '0'.repeat(64). */
  tokenId: string;
  /** Raw amount (no decimal scaling). */
  amount:  bigint;
  /** Recipient Bech32 address. */
  to:      string;
}

export interface WalletSyncState {
  synced:          boolean;
  balances:        WalletBalances | null;
  error:           string | null;
  txStatus:        TxStatus;
  send:            (requests: SendRequest[]) => Promise<void>;
  resetTx:         () => void;
  deployTxStatus:  TxStatus;
  deploy:          (managedPath: string, witnessesPath: string | null) => Promise<void>;
  resetDeploy:     () => void;
  /** Deploy the built-in fungible-token contract. Returns the contract address. */
  deployFT:        () => Promise<string>;
  mintTxStatus:    TxStatus;
  mintResult:      MintResult | null;
  mint:            (contractAddress: string, amount: bigint) => Promise<void>;
  resetMint:       () => void;
}

// Internal sync-only slice; txStatus/send/resetTx are composed at return time.
type SyncCore = { synced: boolean; balances: WalletBalances | null; error: string | null };
const SYNC_IDLE: SyncCore = { synced: false, balances: null, error: null };

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Convert an http(s) URL to the corresponding ws(s) URL. */
function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

/**
 * Sign any unshielded transaction intents embedded in a balanced recipe.
 * Required by the deployContract walletProvider.balanceTx adapter.
 * Ported from shielding-contracts/src/utils.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function signTransactionIntents(tx: any, signFn: (p: Uint8Array) => any, proofMarker: 'proof' | 'pre-proof'): void {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cloned = (ledger as any).Intent.deserialize(
      'signature', proofMarker, 'pre-binding', intent.serialize());
    const signature = signFn(cloned.signatureData(segment));
    if (cloned.fallibleUnshieldedOffer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map((_: any, i: number) =>
        cloned.fallibleUnshieldedOffer.signatures.at(i) ?? signature);
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map((_: any, i: number) =>
        cloned.guaranteedUnshieldedOffer.signatures.at(i) ?? signature);
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
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
  const [syncState,       setSyncState]       = useState<SyncCore>(SYNC_IDLE);
  const [txStatus,        setTxStatus]        = useState<TxStatus>({stage: 'idle'});
  const [deployTxStatus,  setDeployTxStatus]  = useState<TxStatus>({stage: 'idle'});
  const [mintTxStatus,    setMintTxStatus]    = useState<TxStatus>({stage: 'idle'});
  const [mintResult,      setMintResult]      = useState<MintResult | null>(null);

  // Refs for wallet internals — accessible from stable send callback without
  // restarting the wallet subscription.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facadeRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shieldedKeysRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dustKeyRef      = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keystoreRef     = useRef<any>(null);
  const walletAddrRef   = useRef<string | null>(null);

  // Track paused and network via refs so callbacks see the latest values
  // without needing to restart the wallet.
  const pausedRef  = useRef(paused);
  const networkRef = useRef(network);
  useEffect(() => { pausedRef.current  = paused;   }, [paused]);
  useEffect(() => { networkRef.current = network;  }, [network]);

  useEffect(() => {
    if (!mnemonic) {
      setSyncState(SYNC_IDLE);
      return;
    }

    let cancelled     = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let facade: any   = null;
    let sub: Rx.Subscription | null = null;
    let persistState: (() => Promise<unknown[]>) | null = null;

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

        // Unshielded address — used as the cache key (deterministic, human-readable).
        const unshieldedAddr = (unshieldedKeystore.getBech32Address() as any).toString() as string;

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

        // Attempt to restore each wallet from cache; fall back to fresh start on failure.
        const shieldedWallet = (() => {
          const saved = loadState(network.name, unshieldedAddr, 'shielded');
          if (saved) {
            try { return ShieldedWallet(walletCfg).restore(saved); }
            catch {
              logger.warn('Shielded wallet state restore failed — evicting cache and starting fresh');
              deleteState(network.name, unshieldedAddr, 'shielded');
            }
          }
          return ShieldedWallet(walletCfg).startWithSecretKeys(shieldedSecretKeys);
        })();

        const unshieldedWallet = (() => {
          const saved = loadState(network.name, unshieldedAddr, 'unshielded');
          if (saved) {
            try {
              return UnshieldedWallet({
                networkId:               network.name,
                indexerClientConnection: walletCfg.indexerClientConnection,
                txHistoryStorage:        new InMemoryTransactionHistoryStorage(),
              }).restore(saved);
            } catch {
              logger.warn('Unshielded wallet state restore failed — evicting cache and starting fresh');
              deleteState(network.name, unshieldedAddr, 'unshielded');
            }
          }
          return UnshieldedWallet({
            networkId:               network.name,
            indexerClientConnection: walletCfg.indexerClientConnection,
            txHistoryStorage:        new InMemoryTransactionHistoryStorage(),
          }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
        })();

        const dustWallet = (() => {
          const saved = loadState(network.name, unshieldedAddr, 'dust');
          if (saved) {
            try { return DustWallet({
              ...walletCfg,
              costParameters: {
                additionalFeeOverhead: 300_000_000_000_000n,
                feeBlocksMargin:       5,
              },
            }).restore(saved); }
            catch {
              logger.warn('Dust wallet state restore failed — evicting cache and starting fresh');
              deleteState(network.name, unshieldedAddr, 'dust');
            }
          }
          return DustWallet({
            ...walletCfg,
            costParameters: {
              additionalFeeOverhead: 300_000_000_000_000n,
              feeBlocksMargin:       5,
            },
          }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);
        })();

        facade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
        await facade.start(shieldedSecretKeys, dustSecretKey);

        // Expose for the stable send() callback.
        facadeRef.current       = facade;
        shieldedKeysRef.current = shieldedSecretKeys;
        dustKeyRef.current      = dustSecretKey;
        keystoreRef.current     = unshieldedKeystore;
        walletAddrRef.current   = unshieldedAddr;

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
        // Helper: serialize all three wallets and write to cache.
        persistState = () =>
          Promise.all([
            facade.shielded.serializeState().then(
              (v: string) => saveState(network.name, unshieldedAddr, 'shielded', v)),
            facade.unshielded.serializeState().then(
              (v: string) => saveState(network.name, unshieldedAddr, 'unshielded', v)),
            facade.dust.serializeState().then(
              (v: string) => saveState(network.name, unshieldedAddr, 'dust', v)),
          ]);

        let stateSaved = false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sub = (facade.state() as Rx.Observable<any>).pipe(
          Rx.auditTime(1_000),
          Rx.distinctUntilChanged((prev, curr) => stateKey(prev) === stateKey(curr)),
        ).subscribe({
          next: (s) => {
            if (cancelled || pausedRef.current) return;
            // Save state once when the wallet first reaches fully-synced.
            if (s.isSynced === true && !stateSaved) {
              stateSaved = true;
              void persistState?.().catch(
                (e: unknown) => logger.warn(`Wallet state save failed: ${String(e)}`));
            }
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
            setSyncState({
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
            if (!cancelled) setSyncState({
              synced: false, balances: null,
              error: e instanceof Error ? e.message : String(e),
            });
          },
        });
      } catch (e) {
        if (!cancelled) setSyncState({
          synced: false, balances: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    void start();

    return () => {
      cancelled = true;
      sub?.unsubscribe();
      facadeRef.current       = null;
      shieldedKeysRef.current = null;
      dustKeyRef.current      = null;
      keystoreRef.current     = null;
      walletAddrRef.current   = null;
      if (facade) {
        // Best-effort: persist current state before stopping so the next launch
        // can resume from this point.  facade.stop() runs regardless.
        void (persistState ? persistState() : Promise.resolve()).catch(() => {}).finally(() => facade.stop());
      }
    };
  }, [mnemonic, network.name, network.indexerUrl, network.nodeUrl, network.proofServerUrl]);

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  const resetTx = useCallback(() => setTxStatus({stage: 'idle'}), []);

  const send = useCallback(async (requests: SendRequest[]): Promise<void> => {
    const f  = facadeRef.current;
    const sk = shieldedKeysRef.current;
    const dk = dustKeyRef.current;
    const ks = keystoreRef.current;
    if (!f || !sk || !dk || !ks) {
      setTxStatus({stage: 'failed', error: 'Wallet not connected'});
      return;
    }
    try {
      setTxStatus({stage: 'building'});

      // Group outputs by transfer type for the SDK.
      const grouped = new Map<string, {type: string; amount: bigint; receiverAddress: string}[]>();
      for (const r of requests) {
        const out = grouped.get(r.type) ?? [];
        out.push({type: r.tokenId, amount: r.amount, receiverAddress: r.to});
        grouped.set(r.type, out);
      }
      const transfers = [...grouped.entries()].map(([type, outputs]) => ({type, outputs}));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipe = await (f as any).transferTransaction(
        transfers,
        {shieldedSecretKeys: sk, dustSecretKey: dk},
        {ttl: new Date(Date.now() + 30 * 60 * 1000)},
      );

      setTxStatus({stage: 'proving'});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signed = await (f as any).signRecipe(recipe, (payload: Uint8Array) => ks.signData(payload));

      setTxStatus({stage: 'submitting'});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalized = await (f as any).finalizeRecipe(signed);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txHash = await (f as any).submitTransaction(finalized) as string;

      setTxStatus({stage: 'pending', txHash});

      // Log the completed transfer for audit purposes.
      const from = walletAddrRef.current ?? 'unknown';
      for (const r of requests) {
        const night_id = '0'.repeat(64);
        const amtDisplay = r.tokenId === night_id
          ? `${r.amount / 1_000_000n}.${String(r.amount % 1_000_000n).padStart(6, '0')} NIGHT`
          : `${r.amount} ${r.tokenId.slice(0, 8)}…`;
        logger.info(
          `Transfer: ${amtDisplay} (${r.type}) from ${from} to ${r.to} | txHash: ${txHash}`,
        );
      }
    } catch (e) {
      setTxStatus({stage: 'failed', error: e instanceof Error ? e.message : String(e)});
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------

  const resetDeploy = useCallback(() => setDeployTxStatus({stage: 'idle'}), []);

  const deploy = useCallback(async (managedPath: string, witnessesPath: string | null): Promise<void> => {
    const f   = facadeRef.current;
    const sk  = shieldedKeysRef.current;
    const dk  = dustKeyRef.current;
    const ks  = keystoreRef.current;
    const net = networkRef.current;
    if (!f || !sk || !dk || !ks) {
      setDeployTxStatus({stage: 'failed', error: 'Wallet not connected'});
      return;
    }
    try {
      setDeployTxStatus({stage: 'building'});

      const absManaged  = path.resolve(managedPath);
      const contractJs  = path.join(absManaged, 'contract', 'index.js');
      if (!fs.existsSync(contractJs)) {
        setDeployTxStatus({stage: 'failed', error: `No compiled contract at ${contractJs}`});
        return;
      }

      // Coin/encryption public keys — wait for a synced state to ensure keys are valid.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state            = await Rx.firstValueFrom(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f as any).state().pipe(Rx.filter((s: any) => s.isSynced)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const coinPublicKey    = (state as any).shielded.coinPublicKey.toHexString() as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const encPublicKey     = (state as any).shielded.encryptionPublicKey.toHexString() as string;

      const contractName = path.basename(absManaged);

      // Build the walletProvider adapter that deployContract expects.
      const walletProvider = {
        getCoinPublicKey:       () => coinPublicKey,
        getEncryptionPublicKey: () => encPublicKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async balanceTx(tx: any, ttl?: Date) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recipe = await (f as any).balanceUnboundTransaction(
            tx,
            {shieldedSecretKeys: sk, dustSecretKey: dk},
            {ttl: ttl ?? new Date(Date.now() + 30 * 60_000)},
          );
          const signFn = (payload: Uint8Array) => ks.signData(payload);
          signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
          if (recipe.balancingTransaction) {
            signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (f as any).finalizeRecipe(recipe);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        submitTx: (tx: any) => (f as any).submitTransaction(tx) as any,
      };

      const indexerHttpUrl = net.indexerUrl;
      const indexerWsUrl   = toWsUrl(indexerHttpUrl) + '/ws';
      const zkCfgProvider  = new NodeZkConfigProvider(absManaged);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providers: any = {
        privateStateProvider: levelPrivateStateProvider({
          // Wallet-specific LevelDB dir prevents AES-GCM failures when switching wallets.
          midnightDbName:       path.join(CACHE_DIR, 'level-db', net.name, encPublicKey.slice(0, 16)),
          privateStateStoreName: contractName + '-state',
          walletProvider,
        }),
        publicDataProvider: indexerPublicDataProvider(indexerHttpUrl, indexerWsUrl),
        zkConfigProvider:   zkCfgProvider,
        proofProvider:      httpClientProofProvider(net.proofServerUrl, zkCfgProvider),
        walletProvider,
        midnightProvider:   walletProvider,
      };

      // Load compiled contract module.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contractModule: any = await import(pathToFileURL(contractJs).href);

      // Build CompiledContract, optionally with user-supplied witnesses.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let compiledContract: any;
      if (witnessesPath) {
        const absWitnesses  = path.resolve(witnessesPath);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const witMod: any   = await import(pathToFileURL(absWitnesses).href);
        const witnesses     = witMod.default(walletProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeWit: any     = CompiledContract.withWitnesses;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const withAssets: any  = CompiledContract.withCompiledFileAssets;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compiledContract = (CompiledContract.make(contractName, contractModule.Contract) as any).pipe(
          makeWit(witnesses),
          withAssets(absManaged),
        );
      } else {
        compiledContract = CompiledContract.make(contractName, contractModule.Contract).pipe(
          CompiledContract.withVacantWitnesses,
          CompiledContract.withCompiledFileAssets(absManaged),
        );
      }

      // ZK proof generation + submission — the slow part (~30–60 s).
      setDeployTxStatus({stage: 'proving'});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deployed: any = await (deployContract as any)(providers, {
        compiledContract,
        privateStateId:      contractName + 'State',
        initialPrivateState: {},
      });

      const contractAddress: string = deployed.deployTxData.public.contractAddress;
      // Reuse the txHash field to carry the contract address to the UI.
      setDeployTxStatus({stage: 'pending', txHash: contractAddress});
      logger.info(`Deployed contract "${contractName}" at ${contractAddress} on ${net.name}`);

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('Deploy failed', e);
      setDeployTxStatus({stage: 'failed', error: msg});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Deploy FT — deploys the built-in fungible-token contract; returns address.
  // Used by the Mint screen's "deploy new" flow.
  // ---------------------------------------------------------------------------

  const deployFT = useCallback(async (): Promise<string> => {
    const f   = facadeRef.current;
    const sk  = shieldedKeysRef.current;
    const dk  = dustKeyRef.current;
    const ks  = keystoreRef.current;
    const net = networkRef.current;
    if (!f || !sk || !dk || !ks) throw new Error('Wallet not connected');

    const absManaged = BUILTIN_FT_MANAGED;
    const contractJs = path.join(absManaged, 'contract', 'index.js');
    if (!fs.existsSync(contractJs))
      throw new Error(`No compiled contract at ${contractJs}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = await Rx.firstValueFrom(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f as any).state().pipe(Rx.filter((s: any) => s.isSynced)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coinPublicKey = (state as any).shielded.coinPublicKey.toHexString() as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const encPublicKey  = (state as any).shielded.encryptionPublicKey.toHexString() as string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletProvider = {
      getCoinPublicKey:       () => coinPublicKey,
      getEncryptionPublicKey: () => encPublicKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async balanceTx(tx: any, ttl?: Date) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recipe = await (f as any).balanceUnboundTransaction(
          tx,
          {shieldedSecretKeys: sk, dustSecretKey: dk},
          {ttl: ttl ?? new Date(Date.now() + 30 * 60_000)},
        );
        const signFn = (payload: Uint8Array) => ks.signData(payload);
        signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (f as any).finalizeRecipe(recipe);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      submitTx: (tx: any) => (f as any).submitTransaction(tx) as any,
    };

    const indexerHttpUrl = net.indexerUrl;
    const indexerWsUrl   = toWsUrl(indexerHttpUrl) + '/ws';
    const zkCfgProvider  = new NodeZkConfigProvider(absManaged);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providers: any = {
      privateStateProvider: levelPrivateStateProvider({
        midnightDbName:        path.join(CACHE_DIR, 'level-db', net.name, encPublicKey.slice(0, 16)),
        privateStateStoreName: 'fungible-token-state',
        walletProvider,
      }),
      publicDataProvider: indexerPublicDataProvider(indexerHttpUrl, indexerWsUrl),
      zkConfigProvider:   zkCfgProvider,
      proofProvider:      httpClientProofProvider(net.proofServerUrl, zkCfgProvider),
      walletProvider,
      midnightProvider:   walletProvider,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contractModule: any = await import(pathToFileURL(contractJs).href);

    const coinBytes = new Uint8Array(32);
    coinBytes.set(Buffer.from(coinPublicKey.replace(/^0x/, ''), 'hex').subarray(0, 32));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const makeWit: any    = CompiledContract.withWitnesses;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withAssets: any = CompiledContract.withCompiledFileAssets;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compiledContract = (CompiledContract.make('fungible-token', contractModule.Contract) as any).pipe(
      makeWit({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get_user_shielded_address: (context: any) => [context.privateState, {bytes: coinBytes}],
      }),
      withAssets(absManaged),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deployed: any = await (deployContract as any)(providers, {
      compiledContract,
      privateStateId:      'fungibleTokenState',
      initialPrivateState: {},
    });

    const contractAddress: string = deployed.deployTxData.public.contractAddress;
    logger.info(`Deployed fungible-token contract at ${contractAddress} on ${net.name}`);
    return contractAddress;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Mint (fungible-token contract, built-in managed path)
  // ---------------------------------------------------------------------------

  const resetMint = useCallback(() => {
    setMintTxStatus({stage: 'idle'});
    setMintResult(null);
  }, []);

  const mint = useCallback(async (rawContractAddress: string, amount: bigint): Promise<void> => {
    // Normalise: strip any leading 0x so the address is plain hex throughout.
    const contractAddress = rawContractAddress.replace(/^0x/i, '');
    const f   = facadeRef.current;
    const sk  = shieldedKeysRef.current;
    const dk  = dustKeyRef.current;
    const ks  = keystoreRef.current;
    const net = networkRef.current;
    if (!f || !sk || !dk || !ks) {
      setMintTxStatus({stage: 'failed', error: 'Wallet not connected'});
      return;
    }
    try {
      setMintTxStatus({stage: 'building'});
      setMintResult(null);

      // Wait for a synced state so that coin/encryption keys are fully initialised.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state         = await Rx.firstValueFrom(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f as any).state().pipe(Rx.filter((s: any) => s.isSynced)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const coinPublicKey = (state as any).shielded.coinPublicKey.toHexString() as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const encPublicKey  = (state as any).shielded.encryptionPublicKey.toHexString() as string;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walletProvider = {
        getCoinPublicKey:       () => coinPublicKey,
        getEncryptionPublicKey: () => encPublicKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async balanceTx(tx: any, ttl?: Date) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recipe = await (f as any).balanceUnboundTransaction(
            tx,
            {shieldedSecretKeys: sk, dustSecretKey: dk},
            {ttl: ttl ?? new Date(Date.now() + 30 * 60_000)},
          );
          const signFn = (payload: Uint8Array) => ks.signData(payload);
          signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
          if (recipe.balancingTransaction) {
            signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (f as any).finalizeRecipe(recipe);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        submitTx: (tx: any) => (f as any).submitTransaction(tx) as any,
      };

      const indexerHttpUrl = net.indexerUrl;
      const indexerWsUrl   = toWsUrl(indexerHttpUrl) + '/ws';
      const absManaged     = BUILTIN_FT_MANAGED;
      const contractJs     = path.join(absManaged, 'contract', 'index.js');
      const zkCfgProvider  = new NodeZkConfigProvider(absManaged);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const providers: any = {
        privateStateProvider: levelPrivateStateProvider({
          // Wallet-specific LevelDB dir prevents AES-GCM failures when switching wallets.
          midnightDbName:       path.join(CACHE_DIR, 'level-db', net.name, encPublicKey.slice(0, 16)),
          privateStateStoreName: 'fungible-token-state',
          walletProvider,
        }),
        publicDataProvider: indexerPublicDataProvider(indexerHttpUrl, indexerWsUrl),
        zkConfigProvider:   zkCfgProvider,
        proofProvider:      httpClientProofProvider(net.proofServerUrl, zkCfgProvider),
        walletProvider,
        midnightProvider:   walletProvider,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contractModule: any = await import(pathToFileURL(contractJs).href);

      // token_id_bytes = contract address as Bytes<32>
      const cleanHex     = contractAddress.replace(/^0x/, '');
      const tokenIdBytes = new Uint8Array(32);
      tokenIdBytes.set(Buffer.from(cleanHex, 'hex').subarray(0, 32));

      // coin public key bytes for the witness
      const coinBytes = new Uint8Array(32);
      coinBytes.set(Buffer.from(coinPublicKey.replace(/^0x/, ''), 'hex').subarray(0, 32));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const makeWit: any    = CompiledContract.withWitnesses;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withAssets: any = CompiledContract.withCompiledFileAssets;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const compiledContract = (CompiledContract.make('fungible-token', contractModule.Contract) as any).pipe(
        makeWit({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get_user_shielded_address: (context: any) => [context.privateState, {bytes: coinBytes}],
        }),
        withAssets(absManaged),
      );

      setMintTxStatus({stage: 'proving'});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract: any = await (findDeployedContract as any)(providers, {
        contractAddress,
        compiledContract,
        privateStateId:      'fungibleTokenState',
        initialPrivateState: {},
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any  = await contract.callTx.mint(amount, tokenIdBytes);
      const txHash       = result.public.txHash   as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenType    = (result.private.newCoins[0] as any)?.type as string ?? '';

      setMintResult({txHash, tokenType});
      setMintTxStatus({stage: 'pending', txHash});
      logger.info(
        `Minted ${amount} token units from contract ${contractAddress} | ` +
        `token type: ${tokenType} | txHash: ${txHash} | network: ${net.name}`);

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('Mint failed', e);
      setMintTxStatus({stage: 'failed', error: msg});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...syncState, txStatus, send, resetTx,
    deployTxStatus, deploy, resetDeploy, deployFT,
    mintTxStatus, mintResult, mint, resetMint,
  };
}
