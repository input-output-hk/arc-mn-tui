import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner      from 'ink-spinner';
import BalanceTable from '../components/BalanceTable.js';
import DustMonitor  from '../components/DustMonitor.js';
import {useMidnightNode} from '../hooks/useMidnightNode.js';
import {useWallet}       from '../hooks/useWallet.js';
import {useDust}         from '../hooks/useDust.js';
import type {NetworkConfig} from '../types.js';

interface Props {
  network: NetworkConfig;
}

/** Format a millisecond duration as "1h 23m", "47m 09s", or "38s". */
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

function utcTime(): string {
  return new Date().toISOString().slice(11, 19) + ' UTC';
}

export default function Dashboard({network}: Props) {
  const {node, error: nodeError} = useMidnightNode(network.nodeUrl);
  const {activeWallet, wallet}   = useWallet();
  const {dust}                   = useDust();
  const [clock, setClock]        = useState(utcTime);

  useEffect(() => {
    const id = setInterval(() => setClock(utcTime()), 6_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>

      {/* Chain status */}
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        <Box gap={2}>
          <Text bold color="cyan">Chain</Text>
          <Text color="yellow">{network.name}</Text>
        </Box>

        {nodeError ? (
          <Text color="red">⚠ {nodeError}</Text>
        ) : (
          <Box flexDirection="row">
            {/* Left column: label + primary value */}
            <Box flexDirection="column" width={24}>
              <Text dimColor>peers <Text color="white">{node.peers}</Text></Text>
              <Text dimColor>epoch <Text color="white">{node.epochIndex}</Text></Text>
              <Text dimColor>slot  <Text color="white">{node.currentSlot}</Text></Text>
              <Text dimColor>block <Text color="white">{node.blockHeight}</Text></Text>
            </Box>
            {/* Right column: secondary value */}
            <Box flexDirection="column" flexGrow={1}>
              {node.synced
                ? <Text color="green">● synced</Text>
                : <><Text color="yellow"><Spinner type="dots" /></Text><Text color="yellow"> syncing</Text></>
              }
              <Text dimColor>next <Text color="white">{node.msUntilEpoch > 0 ? fmtDuration(node.msUntilEpoch) : '—'}</Text></Text>
              <Text dimColor>{clock}</Text>
              <Text dimColor wrap="truncate">hash <Text color="white">{node.blockHash}</Text></Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Wallet */}
      <Box flexDirection="column">
        <Text bold color="cyan">Wallet</Text>
        {activeWallet ? (
          <>
            <Text dimColor>name        <Text color="white">{activeWallet.name}</Text></Text>
            <Text dimColor>unshielded  <Text color="white">{activeWallet.unshielded}</Text></Text>
            <Text dimColor>shielded    <Text color="white">{activeWallet.shielded}</Text></Text>
            <Text dimColor>dust        <Text color="white">{activeWallet.dust}</Text></Text>
          </>
        ) : (
          <Text color="yellow">No wallet loaded — open Keys screen (5)</Text>
        )}
        <BalanceTable balances={wallet.balances} />
      </Box>

      {/* DUST */}
      <DustMonitor dust={dust} />

    </Box>
  );
}
