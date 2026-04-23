#!/usr/bin/env tsx
/**
 * night-tps.ts — Midnight NIGHT transfer TPS proof-of-viability
 *
 * Commands:
 *   setup   Fund N test wallets from the genesis wallet and register each for DUST.
 *           Wallet mnemonics and addresses are saved to a JSON store for reuse.
 *   run     Load wallets from the store and send a burst of NIGHT transfers,
 *           reporting the submission TPS and per-tx latency.
 *
 * Usage (from experiments/mn-tui/):
 *   npx tsx src/night-tps.ts setup [--wallets 3] [--night 1000] [--network undeployed]
 *   npx tsx src/night-tps.ts run   [--txs 5]     [--network undeployed]
 *
 * Options:
 *   --wallets  N     Number of test wallets to fund (setup, default 3)
 *   --night    N     NIGHT to send to each wallet, in whole NIGHT (setup, default 1000)
 *   --txs      N     Transactions per wallet in run phase (default 5)
 *   --network  NAME  undeployed | preprod (default undeployed)
 *   --store    PATH  Wallet JSON store path (default ./night-tps-wallets.json)
 *   --node     URL   Override node RPC URL
 *   --indexer  URL   Override indexer GraphQL URL
 *   --prover   URL   Override proof server URL
 *
 * Genesis wallet:
 *   The "genesis mint wallet" is derived from the fixed 32-byte seed
 *   0x00…01, which holds all NIGHT minted in the genesis block of a local
 *   Midnight development node.  The genesis wallet is used only during setup.
 */

import { Buffer }                                        from 'buffer';
import * as fs                                           from 'node:fs/promises';
import * as Rx                                           from 'rxjs';
import * as bip39                                        from 'bip39';
import * as ledger                                       from '@midnight-ntwrk/ledger-v8';
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
import { MidnightBech32m, UnshieldedAddress }            from '@midnight-ntwrk/wallet-sdk-address-format';
import { setNetworkId }                                  from '@midnight-ntwrk/midnight-js-network-id';
import { WebSocket }                                     from 'ws';

// Must register WebSocket globally before any SDK code runs.
(globalThis as any).WebSocket = WebSocket;

// Suppress RPC-CORE connection/disconnection noise from the Polkadot.js logger.
// The SDK's internal logger creates bound console.error references at module
// import time (before any of our module-level code runs), so patching
// console.error/console.warn after-the-fact is too late.  Intercepting
// process.stderr.write works because console.* ultimately calls it dynamically.
{
  const _origWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;
  process.stderr.write = ((chunk: Uint8Array | string, ...rest: unknown[]) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString();
    if (s.includes('RPC-CORE') || s.includes('RPC/CORE')) return true;
    return (_origWrite as any)(chunk, ...rest);
  }) as typeof process.stderr.write;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIGHT native token identifier (64 zero hex digits). */
const NIGHT_ID = '0'.repeat(64);

/** Fixed seed for the genesis mint wallet on a local dev node. */
const GENESIS_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** NIGHT amount sent in each run-phase transfer (1 NIGHT). */
const SEND_AMT = 1_000_000n;

/**
 * Minimum DUST balance required before attempting the next sequential
 * transaction in a wallet.  After each tx the DUST-generating NIGHT UTXOs are
 * consumed and re-registered, so the balance returns to 0 at confirmation and
 * then accrues from scratch.  Set to 500 trillion (≈ 1.67× additionalFeeOverhead)
 * to give a comfortable margin; with 1000 NIGHT registered, this level
 * re-accrues in roughly 75–90 s after confirmation.
 */
const MIN_DUST_PER_TX = 500_000_000_000_000n;

/** Network endpoint presets. */
const NETWORK_DEFAULTS: Record<string, { node: string; indexer: string; prover: string }> = {
  // node-lan pod: node-1 RPC is exposed on 9945, indexer on 8088, proof server on 6300.
  undeployed: {
    node:    'http://localhost:9945',
    indexer: 'http://localhost:8088/api/v4/graphql',
    prover:  'http://localhost:6300',
  },
  preprod: {
    node:    'https://rpc.preprod.midnight.network',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    prover:  'https://proof-server.preprod.midnight.network',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NetConfig {
  network: string;
  node:    string;
  indexer: string;
  prover:  string;
}

interface WalletCtx {
  facade:             WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey:      ledger.DustSecretKey;
  keystore:           ReturnType<typeof createKeystore>;
  network:            string;
}

interface WalletRecord {
  name:     string;
  mnemonic: string;
  address:  string;
}

interface WalletStore {
  network: string;
  wallets: WalletRecord[];
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function toWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

// ---------------------------------------------------------------------------
// Key derivation (offline — no network connection required)
// ---------------------------------------------------------------------------

function deriveKeys(seed: Buffer): {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey:      ledger.DustSecretKey;
  keystore:           ReturnType<typeof createKeystore>;
} {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('HDWallet.fromSeed failed');

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();

  // keystore construction requires the network ID to have been set already.
  const keystore           = createKeystore(derived.keys[Roles.NightExternal], '');
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey      = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  return { shieldedSecretKeys, dustSecretKey, keystore };
}

async function mnemonicToSeed(mnemonic: string): Promise<Buffer> {
  return bip39.mnemonicToSeed(mnemonic.trim());
}

/** Derive the Bech32 unshielded address from a seed without opening a wallet. */
async function deriveAddress(seed: Buffer, network: string): Promise<string> {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('HDWallet.fromSeed failed');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();
  const ks = createKeystore(derived.keys[Roles.NightExternal], network);
  return (ks.getBech32Address() as any).toString();
}

// ---------------------------------------------------------------------------
// Wallet lifecycle
// ---------------------------------------------------------------------------

async function initWallet(seed: Buffer, cfg: NetConfig): Promise<WalletCtx> {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('HDWallet.fromSeed failed');

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey      = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const keystore           = createKeystore(derived.keys[Roles.NightExternal], cfg.network);

  const indexerHttpUrl = cfg.indexer;
  const indexerWsUrl   = toWsUrl(cfg.indexer) + '/ws';
  const relayURL       = new URL(toWsUrl(cfg.node));
  const provingServerUrl = new URL(cfg.prover);

  const walletCfg = {
    networkId:               cfg.network,
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    provingServerUrl,
    relayURL,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shielded   = (ShieldedWallet as any)(walletCfg).startWithSecretKeys(shieldedSecretKeys);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unshielded = (UnshieldedWallet as any)({
    networkId:               cfg.network,
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    txHistoryStorage:        new InMemoryTransactionHistoryStorage(),
  }).startWithPublicKey(PublicKey.fromKeyStore(keystore));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dust = (DustWallet as any)({
    networkId:               cfg.network,
    costParameters:          { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
  }).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const facade = await (WalletFacade as any).init({
    configuration: { ...walletCfg, costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 } } as any,
    shielded:   () => shielded,
    unshielded: () => unshielded,
    dust:       () => dust,
  });
  await (facade as any).start(shieldedSecretKeys, dustSecretKey);

  return { facade, shieldedSecretKeys, dustSecretKey, keystore, network: cfg.network };
}

function walletAddress(ctx: WalletCtx): string {
  return (ctx.keystore.getBech32Address() as any).toString();
}

async function closeWallet(ctx: WalletCtx): Promise<void> {
  try { await ctx.facade.stop(); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Wallet state observers
// ---------------------------------------------------------------------------

/**
 * Subscribe to the wallet state observable until `pred` is satisfied.
 * Retries on observable errors (e.g. transient Wallet.Sync errors emitted by
 * the new SDK) instead of propagating them, capped at `maxRetries` attempts.
 */
async function waitForCondition(
  ctx:         WalletCtx,
  pred:        (s: any) => boolean,
  label:       string,
  maxRetries = 20,
  retryMs    = 2_000,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await Rx.firstValueFrom(
        (ctx.facade as any).state().pipe(
          Rx.filter(pred),
        ),
      );
      return;
    } catch (e: unknown) {
      if (attempt >= maxRetries) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`  [${label}] transient error (attempt ${attempt + 1}/${maxRetries}): ${msg}\n`);
      await new Promise<void>(r => setTimeout(r, retryMs));
    }
  }
}

async function waitForSync(ctx: WalletCtx): Promise<void> {
  await waitForCondition(ctx, (s: any) => s.isSynced === true, 'sync');
}

async function waitForFunds(ctx: WalletCtx): Promise<void> {
  await waitForCondition(
    ctx,
    (s: any) =>
      s.isSynced === true &&
      ((s.unshielded?.balances?.[NIGHT_ID] ?? 0n) +
       (s.shielded?.balances?.[NIGHT_ID]   ?? 0n)) > 0n,
    'funds',
  );
}

async function waitForDust(ctx: WalletCtx): Promise<void> {
  process.stdout.write('  Waiting for DUST to accrue');
  await waitForCondition(
    ctx,
    (s: any) => {
      process.stdout.write('.');
      return s.isSynced === true &&
        (s.dust?.balance?.(new Date()) ?? 0n) > 0n;
    },
    'dust',
  );
  process.stdout.write('\n');
}

/**
 * Wait until the wallet is synced (tx confirmed, DUST generators re-registered)
 * and enough DUST has accrued for the next transaction.
 * Call this between consecutive transactions on the same wallet.
 */
async function waitForNextTx(ctx: WalletCtx): Promise<void> {
  await waitForCondition(
    ctx,
    (s: any) =>
      s.isSynced === true &&
      (s.dust?.balance?.(new Date()) ?? 0n) >= MIN_DUST_PER_TX,
    'next-tx',
    /* maxRetries */ 90,
    /* retryMs   */ 2_000,
  );
}

async function getNightBalance(ctx: WalletCtx): Promise<bigint> {
  const s: any = await Rx.firstValueFrom((ctx.facade as any).state());
  return (s.unshielded?.balances?.[NIGHT_ID] ?? 0n) +
         (s.shielded?.balances?.[NIGHT_ID]   ?? 0n);
}

async function getDustBalance(ctx: WalletCtx): Promise<bigint> {
  const s: any = await Rx.firstValueFrom((ctx.facade as any).state());
  return s.dust?.balance?.(new Date()) ?? 0n;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

async function registerForDust(ctx: WalletCtx): Promise<string | null> {
  const state: any = await Rx.firstValueFrom(
    (ctx.facade as any).state().pipe(
      Rx.filter((s: any) => s.isSynced === true),
    ),
  );
  const utxos: any[] = (state.unshielded?.availableCoins ?? [])
    .filter((c: any) => !c.meta?.registeredForDustGeneration);

  if (utxos.length === 0) {
    console.log('  All NIGHT UTXOs already registered for DUST generation.');
    return null;
  }

  console.log(`  Registering ${utxos.length} NIGHT UTXO(s) for DUST generation…`);
  for (const u of utxos) {
    const repr = JSON.stringify(u, (_, v) => typeof v === 'bigint' ? `${v}` : v);
    console.log(`    UTXO: ${repr.slice(0, 160)}${repr.length > 160 ? '…' : ''}`);
  }
  const recipe    = await (ctx.facade as any).registerNightUtxosForDustGeneration(
    utxos,
    ctx.keystore.getPublicKey(),
    (payload: Uint8Array) => ctx.keystore.signData(payload),
  );
  // Registration is self-contained (fee covered by future DUST); the SDK returns an
  // already-proven recipe.  Skip balanceUnprovenTransaction — it would hang the
  // proving server.  Pass the recipe directly to finalizeRecipe.
  const finalized = await (ctx.facade as any).finalizeRecipe(recipe);
  const txHash    = await (ctx.facade as any).submitTransaction(finalized) as string;
  console.log(`  DUST registration tx: ${txHash}`);
  return txHash;
}

async function transferNight(
  ctx:    WalletCtx,
  toAddr: string,
  amount: bigint,
): Promise<string> {
  const ttl    = new Date(Date.now() + 30 * 60 * 1000);
  const recipe = await (ctx.facade as any).transferTransaction(
    [{
      type:    'unshielded',
      outputs: [{ type: NIGHT_ID, amount, receiverAddress: MidnightBech32m.parse(toAddr).decode(UnshieldedAddress, ctx.network) }],
    }],
    { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
    { ttl },
  );
  const signed    = await (ctx.facade as any).signRecipe(
    recipe,
    (payload: Uint8Array) => ctx.keystore.signData(payload),
  );
  const finalized = await (ctx.facade as any).finalizeRecipe(signed);
  return (ctx.facade as any).submitTransaction(finalized) as Promise<string>;
}

/**
 * Like `transferNight` but retries with exponential back-off on transient
 * "could not balance dust" failures.  The wallet's DUST balance predicate can
 * fire on a cached snapshot that is slightly out of date; the retry absorbs
 * those rare misses without requiring a long up-front wait.
 */
async function transferNightWithRetry(
  ctx:    WalletCtx,
  toAddr: string,
  amount: bigint,
  label:  string,
): Promise<string> {
  const DUST_ERR = 'could not balance dust';
  let delayMs = 15_000;
  for (;;) {
    try {
      return await transferNight(ctx, toAddr, amount);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes(DUST_ERR)) throw e;
      process.stderr.write(`  [${label}] dust error — retrying in ${delayMs / 1000}s\n`);
      await new Promise<void>(r => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 120_000);
    }
  }
}

// ---------------------------------------------------------------------------
// setup command
// ---------------------------------------------------------------------------

async function cmdSetup(opts: {
  nWallets:     number;
  txsPerWallet: number;
  night:        bigint;
  storePath:    string;
  cfg:          NetConfig;
}): Promise<void> {
  const { nWallets, txsPerWallet, night, storePath, cfg } = opts;
  console.log(`\n=== setup: funding ${nWallets} wallet(s) × (${fmtNight(night)} NIGHT DUST + ${txsPerWallet} × ${fmtNight(SEND_AMT)} NIGHT run) on ${cfg.network} ===\n`);

  // 1. Genesis wallet --------------------------------------------------------
  console.log('Initialising genesis wallet (seed 00…01)…');
  const genesisCtx  = await initWallet(Buffer.from(GENESIS_SEED, 'hex'), cfg);
  const genesisAddr = walletAddress(genesisCtx);
  console.log(`Genesis address : ${genesisAddr}`);

  console.log('Waiting for genesis wallet sync…');
  await waitForSync(genesisCtx);

  const genBal = await getNightBalance(genesisCtx);
  console.log(`Genesis NIGHT   : ${fmtNight(genBal)}`);
  if (genBal === 0n) throw new Error('Genesis wallet has no NIGHT — is the node running with this genesis state?');

  // Genesis wallet needs DUST to pay transfer fees.
  const genDust = await getDustBalance(genesisCtx);
  if (genDust === 0n) {
    console.log('\nRegistering genesis wallet for DUST…');
    await registerForDust(genesisCtx);
    await waitForDust(genesisCtx);
  } else {
    console.log(`Genesis DUST    : ${genDust} (already registered)`);
  }

  // 2. Generate mnemonics and derive addresses (offline) --------------------
  console.log('\nGenerating test wallet mnemonics…');
  const records: WalletRecord[] = [];
  for (let i = 0; i < nWallets; i++) {
    const name     = `wallet-${i + 1}`;
    const mnemonic = bip39.generateMnemonic(256); // 24 words
    const seed     = await mnemonicToSeed(mnemonic);
    const address  = await deriveAddress(seed, cfg.network);
    records.push({ name, mnemonic, address });
    console.log(`  ${name}: ${address}`);
  }

  // 3. Transfer NIGHT from genesis to each wallet.
  //    Two kinds of UTXO are created per wallet:
  //      • One large UTXO (--night, default 1000 NIGHT) for DUST accrual — not
  //        spent during the run, so DUST continues to accumulate between runs.
  //      • txsPerWallet × SEND_AMT (1 NIGHT each) as individual run UTXOs —
  //        one confirmed UTXO per planned run transaction so each tx can spend
  //        a different pre-confirmed coin and avoid the "pending change" problem.
  //    The genesis wallet SDK tracks its own pending change, so all of these
  //    can be submitted without waiting for confirmation between transfers.
  console.log('\nFunding test wallets from genesis…');
  for (const w of records) {
    console.log(`  ${w.name}: sending ${fmtNight(night)} NIGHT (DUST UTXO)…`);
    const txHash = await transferNight(genesisCtx, w.address, night);
    console.log(`  tx: ${txHash}`);
  }
  console.log(`\n  Creating ${txsPerWallet} run UTXO(s) of ${fmtNight(SEND_AMT)} NIGHT per wallet…`);
  for (const w of records) {
    for (let t = 0; t < txsPerWallet; t++) {
      const txHash = await transferNight(genesisCtx, w.address, SEND_AMT);
      console.log(`  ${w.name} run UTXO ${t + 1}/${txsPerWallet}: ${txHash}`);
    }
  }
  await closeWallet(genesisCtx);

  // 4. Save wallet store before DUST registration so partial progress is kept.
  const store: WalletStore = { network: cfg.network, wallets: records };
  await fs.writeFile(storePath, JSON.stringify(store, null, 2));
  console.log(`\nWallet store saved to ${storePath}`);

  // 5. Register each wallet for DUST ----------------------------------------
  console.log('\nRegistering test wallets for DUST…');
  for (const w of records) {
    console.log(`\n${w.name} (${w.address})`);
    const seed = await mnemonicToSeed(w.mnemonic);
    const ctx  = await initWallet(seed, cfg);

    console.log('  Waiting for sync + funds…');
    await waitForSync(ctx);
    await waitForFunds(ctx);

    const bal = await getNightBalance(ctx);
    console.log(`  NIGHT balance : ${fmtNight(bal)}`);

    await registerForDust(ctx);
    await waitForDust(ctx);

    const dust = await getDustBalance(ctx);
    console.log(`  DUST balance  : ${dust}`);
    await closeWallet(ctx);
  }

  console.log('\n=== setup complete — wallets are funded and ready for "run" ===');
}

// ---------------------------------------------------------------------------
// run command
// ---------------------------------------------------------------------------

interface TxResult {
  wallet: string;
  seq:    number;
  txHash: string;
  ms:     number;
}

async function cmdRun(opts: {
  txsPerWallet: number;
  storePath:    string;
  cfg:          NetConfig;
}): Promise<void> {
  const { txsPerWallet, storePath, cfg } = opts;

  const raw   = await fs.readFile(storePath, 'utf-8').catch(() => {
    throw new Error(`Wallet store not found at ${storePath} — run "setup" first`);
  });
  const store: WalletStore = JSON.parse(raw);
  if (store.wallets.length === 0) throw new Error('No wallets in store — run "setup" first');

  const nWallets  = store.wallets.length;
  const totalTxs  = nWallets * txsPerWallet;

  console.log(`\n=== run: ${nWallets} wallet(s) × ${txsPerWallet} tx(s) = ${totalTxs} transfers on ${cfg.network} ===\n`);

  // Initialise all wallets in parallel.
  console.log('Initialising wallets…');
  const ctxs = await Promise.all(
    store.wallets.map(async (w) => {
      const seed = await mnemonicToSeed(w.mnemonic);
      return initWallet(seed, cfg);
    }),
  );

  console.log('Waiting for all wallets to sync…');
  await Promise.all(ctxs.map(waitForSync));

  // Verify DUST is available.
  for (let i = 0; i < ctxs.length; i++) {
    const dust = await getDustBalance(ctxs[i]);
    if (dust === 0n) {
      throw new Error(`${store.wallets[i].name} has no DUST — re-run "setup" or wait for DUST to accrue`);
    }
    console.log(`  ${store.wallets[i].name}: DUST=${dust}, NIGHT=${fmtNight(await getNightBalance(ctxs[i]))}`);
  }

  // Each wallet sends to the next in a circular pattern.
  const results: TxResult[] = [];
  console.log(`\nSending (circular pattern, each wallet → next)…`);

  const globalStart = Date.now();

  await Promise.all(
    ctxs.map(async (ctx, i) => {
      const toAddr = walletAddress(ctxs[(i + 1) % nWallets]);
      const name   = store.wallets[i].name;
      for (let t = 0; t < txsPerWallet; t++) {
        if (t > 0) {
          await waitForNextTx(ctx);
          console.log(`  ${name} tx ${t}/${txsPerWallet} confirmed`);
        }
        const t0     = Date.now();
        const txHash = await transferNightWithRetry(ctx, toAddr, SEND_AMT, name);
        const ms     = Date.now() - t0;
        results.push({ wallet: name, seq: t + 1, txHash, ms });
        console.log(`  ${name} tx ${t + 1}/${txsPerWallet}  ${txHash}  (${ms} ms)`);
      }
    }),
  );

  const totalMs  = Date.now() - globalStart;
  const avgMs    = Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length);
  const minMs    = Math.min(...results.map((r) => r.ms));
  const maxMs    = Math.max(...results.map((r) => r.ms));
  const tps      = (totalTxs / (totalMs / 1000)).toFixed(2);

  console.log(`
=== Results ===
Total transactions : ${totalTxs}
Wall-clock time    : ${(totalMs / 1000).toFixed(2)} s
Submission TPS     : ${tps}  (proof generation + submission, not finality)
Latency per tx     : avg ${avgMs} ms  min ${minMs} ms  max ${maxMs} ms
`);

  await Promise.all(ctxs.map(closeWallet));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtNight(raw: bigint): string {
  return `${raw / 1_000_000n}.${String(raw % 1_000_000n).padStart(6, '0')}`;
}

function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Midnight NIGHT transfer TPS experiment

Commands:
  setup   Fund test wallets from the genesis wallet and register DUST
  run     Burst NIGHT transfers across funded wallets and report TPS

Options (both commands):
  --network  NAME   undeployed | preprod          (default: undeployed)
  --store    PATH   Wallet JSON store path         (default: ./night-tps-wallets.json)
  --node     URL    Node RPC URL
  --indexer  URL    Indexer GraphQL URL
  --prover   URL    Proof server URL

Options (setup only):
  --wallets  N      Number of test wallets          (default: 3)
  --night    N      NIGHT for DUST UTXO (whole units)(default: 1000)

Options (setup and run):
  --txs      N      Transactions per wallet          (default: 5)
                    setup creates N pre-funded 1-NIGHT UTXOs per wallet

Examples:
  npx tsx src/night-tps.ts setup --wallets 5 --night 500
  npx tsx src/night-tps.ts run   --txs 10
`);
    process.exit(0);
  }

  const network   = flag(rest, 'network', 'undeployed');
  const storePath = flag(rest, 'store',   './night-tps-wallets.json');
  const defaults  = NETWORK_DEFAULTS[network] ?? NETWORK_DEFAULTS['undeployed'];

  const cfg: NetConfig = {
    network,
    node:    flag(rest, 'node',    defaults.node),
    indexer: flag(rest, 'indexer', defaults.indexer),
    prover:  flag(rest, 'prover',  defaults.prover),
  };

  setNetworkId(cfg.network as any);
  console.log(`Network : ${cfg.network}`);
  console.log(`Node    : ${cfg.node}`);
  console.log(`Indexer : ${cfg.indexer}`);
  console.log(`Prover  : ${cfg.prover}`);

  switch (command) {
    case 'setup': {
      const nWallets     = parseInt(flag(rest, 'wallets', '3'));
      const txsPerWallet = parseInt(flag(rest, 'txs', '5'));
      const nightN       = parseFloat(flag(rest, 'night', '1000'));
      const night        = BigInt(Math.floor(nightN * 1_000_000));
      await cmdSetup({ nWallets, txsPerWallet, night, storePath, cfg });
      break;
    }
    case 'run': {
      const txsPerWallet = parseInt(flag(rest, 'txs', '5'));
      await cmdRun({ txsPerWallet, storePath, cfg });
      break;
    }
    default:
      console.error(`Unknown command: "${command}". Use "setup" or "run" (or --help).`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nFatal error:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
