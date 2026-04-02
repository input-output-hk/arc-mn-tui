import React, {useState, useCallback}           from 'react';
import {Box, Text, useInput}                     from 'ink';
import TextInput                                  from 'ink-text-input';
import * as path                                  from 'node:path';
import {pathToFileURL, fileURLToPath}             from 'node:url';
import {getPublicStates}                          from '@midnight-ntwrk/midnight-js-contracts';
import {indexerPublicDataProvider}                from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import type {NetworkConfig}                       from '../types.js';

const BUILTIN_FT_MANAGED = fileURLToPath(
  new URL('../../contracts/managed/fungible-token', import.meta.url));

interface LedgerData {
  totalSupply: bigint;
  mintNonce:   bigint;
}

type Step = 'input' | 'loading' | 'result';

interface Props {
  network: NetworkConfig;
}

export default function Contract({network}: Props) {
  const [step,    setStep]    = useState<Step>('input');
  const [draft,   setDraft]   = useState('');
  const [fetched, setFetched] = useState('');
  const [data,    setData]    = useState<LedgerData | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const fetchState = useCallback(async (addr: string) => {
    const clean = addr.trim().replace(/^0x/i, '');
    if (!clean) return;
    setFetched(clean);
    setStep('loading');
    setError(null);
    try {
      const httpUrl = network.indexerUrl;
      const wsUrl   = httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = indexerPublicDataProvider(httpUrl, wsUrl) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const {contractState} = await (getPublicStates as any)(provider, clean) as any;
      const contractJs = path.join(BUILTIN_FT_MANAGED, 'contract', 'index.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(pathToFileURL(contractJs).href);
      const ls = mod.ledger(contractState.data);
      setData({totalSupply: ls.total_supply as bigint, mintNonce: ls.mint_nonce as bigint});
      setError(null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep('result');
    }
  }, [network]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (step !== 'result') return;
    if (input === 'r')           { void fetchState(fetched); return; }
    if (input === 'n' || key.escape) { setDraft(fetched); setStep('input'); }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Contract State</Text>
      <Text dimColor>Reads the public ledger state of a fungible-token contract.</Text>

      {step === 'input' && (
        <Box gap={1}>
          <Text>Contract address: </Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={v => void fetchState(v)}
            placeholder="hex contract address"
          />
        </Box>
      )}

      {step === 'loading' && (
        <Text dimColor>Fetching state…</Text>
      )}

      {step === 'result' && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" borderStyle="single" paddingX={1}>
            <Text dimColor>address      <Text color="white">{fetched}</Text></Text>
            {data ? (
              <>
                <Text dimColor>total_supply <Text color="white">{String(data.totalSupply)}</Text></Text>
                <Text dimColor>mint_nonce   <Text color="white">{String(data.mintNonce)}</Text></Text>
              </>
            ) : (
              <Text color="red">{error}</Text>
            )}
          </Box>
          <Text dimColor>[r] refresh  [n / Esc] new address</Text>
        </Box>
      )}
    </Box>
  );
}
