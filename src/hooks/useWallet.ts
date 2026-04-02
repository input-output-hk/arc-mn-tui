import {useState, useCallback} from 'react';
import type {WalletState, TokenBalance, SendParams, TxStatus} from '../types.js';

// ---------------------------------------------------------------------------
// TODO: Replace stub with real Midnight wallet SDK calls.
//   Suggested approach:
//     - Initialise @midnight-ntwrk/midnight-js-wallet with a mnemonic or
//       seed phrase entered by the user.
//     - Expose balances via the wallet's balance observable / query.
//     - Derive addresses using the wallet's key-derivation API.
//     - Submit shielded / unshielded transfers via the wallet's transfer API.
// ---------------------------------------------------------------------------

const STUB_BALANCES: TokenBalance[] = [
  {symbol: 'NIGHT', kind: 'NIGHT',      amount: 1_000_000_000n, decimals: 6},
  {symbol: 'DUST',  kind: 'DUST',       amount:     500_000_000n, decimals: 6},
  {symbol: 'tUSDC', kind: 'unshielded', amount:   1_000_000_000n, decimals: 6},
  {symbol: 'pUSDC', kind: 'shielded',   amount:     250_000_000n, decimals: 6},
];

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address:   '0x0000…0000',   // TODO: derive from mnemonic
    balances:  STUB_BALANCES,
    connected: false,
  });

  const [txStatus, setTxStatus] = useState<TxStatus>({stage: 'idle'});

  // ---- connect -------------------------------------------------------
  // TODO: accept mnemonic or seed; initialise the Midnight wallet SDK.
  const connect = useCallback(async (_mnemonic: string) => {
    setWallet(prev => ({...prev, connected: true, address: '0xSTUB…STUB'}));
  }, []);

  // ---- send ----------------------------------------------------------
  // TODO: call wallet.transfer(params) and stream TxStatus updates.
  const send = useCallback(async (params: SendParams) => {
    setTxStatus({stage: 'building'});
    await delay(500);
    setTxStatus({stage: 'proving'});
    await delay(1_500);
    setTxStatus({stage: 'submitting'});
    await delay(500);
    setTxStatus({stage: 'pending', txHash: '0xSTUB_TX_HASH'});
    await delay(6_000);
    setTxStatus({stage: 'confirmed', txHash: '0xSTUB_TX_HASH', blockHeight: 42});
    void params; // suppress unused warning until real implementation
  }, []);

  // ---- derive addresses -----------------------------------------------
  // TODO: use the wallet SDK's key-derivation path for spending / viewing keys.
  const deriveAddresses = useCallback((_mnemonic: string, _count: number) => {
    return [
      {index: 0, shielded: '0xSHIELDED_0', unshielded: '0xUNSHIELDED_0'},
      {index: 1, shielded: '0xSHIELDED_1', unshielded: '0xUNSHIELDED_1'},
    ];
  }, []);

  return {wallet, txStatus, connect, send, deriveAddresses};
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
