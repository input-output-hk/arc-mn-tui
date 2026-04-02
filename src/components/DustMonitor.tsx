import React from 'react';
import {Box, Text} from 'ink';
import type {DustState} from '../types.js';

interface Props {
  dust: DustState;
}

function fmt(amount: bigint, decimals = 6): string {
  const d = 10n ** BigInt(decimals);
  return `${amount / d}.${(amount % d).toString().padStart(decimals, '0')}`;
}

export default function DustMonitor({dust}: Props) {
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="cyan">DUST Generation</Text>
      <Box gap={2}>
        <Box width={20}><Text dimColor>Designated NIGHT</Text></Box>
        <Text>{fmt(dust.designated)} NIGHT</Text>
      </Box>
      <Box gap={2}>
        <Box width={20}><Text dimColor>Accrued DUST</Text></Box>
        <Text color="green">{fmt(dust.accrued)} DUST</Text>
      </Box>
      <Box gap={2}>
        <Box width={20}><Text dimColor>Rate (per epoch)</Text></Box>
        <Text>{fmt(dust.generationRate)} DUST</Text>
      </Box>
      <Box gap={2}>
        <Box width={20}><Text dimColor>Next epoch at block</Text></Box>
        <Text>{dust.nextEpoch}</Text>
      </Box>
    </Box>
  );
}
