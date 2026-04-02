import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput  from 'ink-text-input';
import SelectInput from 'ink-select-input';
import TxStatusComponent from '../components/TxStatus.js';
import {useWallet} from '../hooks/useWallet.js';
import type {TokenKind, SendParams} from '../types.js';

type Step = 'token' | 'recipient' | 'amount' | 'confirm' | 'submitting';

interface Props {
  onComplete: () => void;
}

const TOKEN_ITEMS: {label: string; value: TokenKind}[] = [
  {label: 'DUST        (shielded)',   value: 'DUST'},
  {label: 'NIGHT       (unshielded)', value: 'NIGHT'},
  {label: 'Unshielded token',         value: 'unshielded'},
  {label: 'Shielded token',           value: 'shielded'},
];

export default function Send({onComplete}: Props) {
  const {txStatus, send} = useWallet();

  const [step,      setStep]      = useState<Step>('token');
  const [token,     setToken]     = useState<TokenKind>('NIGHT');
  const [recipient, setRecipient] = useState('');
  const [amount,    setAmount]    = useState('');

  async function handleConfirm() {
    setStep('submitting');
    const params: SendParams = {recipient, amount, token};
    // TODO: replace stub call in useWallet with real SDK transfer
    await send(params);
  }

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" gap={1}>
        <TxStatusComponent status={txStatus} />
        {txStatus.stage === 'confirmed' && (
          <Text color="green" onPress={onComplete}>
            Press Enter to return to dashboard
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Send Tokens</Text>

      {/* Step 1 — token selection */}
      {step === 'token' && (
        <Box flexDirection="column">
          <Text>Select token to send:</Text>
          <SelectInput
            items={TOKEN_ITEMS}
            onSelect={item => { setToken(item.value); setStep('recipient'); }}
          />
        </Box>
      )}

      {/* Step 2 — recipient address */}
      {step === 'recipient' && (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Token: <Text color="white">{token}</Text></Text>
          <Box gap={1}>
            <Text>Recipient address: </Text>
            <TextInput
              value={recipient}
              onChange={setRecipient}
              onSubmit={() => setStep('amount')}
              placeholder="0x… or shielded address"
            />
          </Box>
        </Box>
      )}

      {/* Step 3 — amount */}
      {step === 'amount' && (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Token: <Text color="white">{token}</Text></Text>
          <Text dimColor>To:    <Text color="white">{recipient}</Text></Text>
          <Box gap={1}>
            <Text>Amount: </Text>
            <TextInput
              value={amount}
              onChange={setAmount}
              onSubmit={() => setStep('confirm')}
              placeholder="0.000000"
            />
          </Box>
        </Box>
      )}

      {/* Step 4 — confirmation */}
      {step === 'confirm' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm transaction</Text>
          <Box gap={2}>
            <Text dimColor>Token</Text>
            <Text>{token}</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>To   </Text>
            <Text>{recipient}</Text>
          </Box>
          <Box gap={2}>
            <Text dimColor>Amount</Text>
            <Text>{amount}</Text>
          </Box>
          <SelectInput
            items={[
              {label: 'Confirm and send', value: 'confirm'},
              {label: 'Cancel',          value: 'cancel'},
            ]}
            onSelect={item => {
              if (item.value === 'confirm') handleConfirm();
              else onComplete();
            }}
          />
        </Box>
      )}
    </Box>
  );
}
