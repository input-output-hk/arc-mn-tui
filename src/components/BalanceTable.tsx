import React from 'react';
import {Box, Text} from 'ink';
import type {TokenBalance} from '../types.js';

interface Props {
  balances: TokenBalance[];
}

function formatAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole   = amount / divisor;
  const frac    = amount % divisor;
  return `${whole}.${frac.toString().padStart(decimals, '0')}`;
}

export default function BalanceTable({balances}: Props) {
  if (balances.length === 0) {
    return <Text dimColor>No balances available.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Text bold color="cyan" width={10}>Token</Text>
        <Text bold color="cyan" width={8}>Type</Text>
        <Text bold color="cyan">Amount</Text>
      </Box>
      <Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>
      {balances.map(b => (
        <Box key={`${b.symbol}-${b.kind}`} gap={2}>
          <Text bold width={10}>{b.symbol}</Text>
          <Text dimColor width={8}>{b.kind}</Text>
          <Text>{formatAmount(b.amount, b.decimals)}</Text>
        </Box>
      ))}
    </Box>
  );
}
