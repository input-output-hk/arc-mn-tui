import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import TextInput   from 'ink-text-input';
import SelectInput from 'ink-select-input';
import TxStatusComponent from '../components/TxStatus.js';
import {useWallet} from '../hooks/useWallet.js';
import type {MintParams} from '../types.js';
import {useInputMode} from '../hooks/useInputMode.js';

type Step = 'kind' | 'contract' | 'recipient' | 'amount' | 'confirm' | 'submitting';

interface Props {
  onComplete: () => void;
}

export default function Mint({onComplete}: Props) {
  const {txStatus} = useWallet();

  const [step,            setStep]            = useState<Step>('kind');

  const {setInputActive} = useInputMode();
  useEffect(() => {
    setInputActive(['contract', 'recipient', 'amount'].includes(step));
    return () => setInputActive(false);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shielded,        setShielded]        = useState(false);
  const [contractAddress, setContractAddress] = useState('');
  const [recipient,       setRecipient]       = useState('');
  const [amount,          setAmount]          = useState('');

  async function handleConfirm() {
    setStep('submitting');
    const _params: MintParams = {contractAddress, recipient, amount, shielded};
    // TODO: call the token contract's mint entry-point via the wallet SDK.
    //   For an unshielded token:
    //     wallet.contractCall(contractAddress, 'mint', { recipient, amount })
    //   For a shielded token:
    //     wallet.contractCall(contractAddress, 'mintShielded', { recipient, amount })
    await new Promise(r => setTimeout(r, 3_000)); // stub delay
    void _params;
  }

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" gap={1}>
        <TxStatusComponent status={txStatus} />
        {txStatus.stage === 'confirmed' && (
          <Text color="green">Press Enter to return to dashboard</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Mint Tokens</Text>

      {step === 'kind' && (
        <Box flexDirection="column">
          <Text>Select token type to mint:</Text>
          <SelectInput
            items={[
              {label: 'Unshielded token', value: 'unshielded'},
              {label: 'Shielded token',   value: 'shielded'},
            ]}
            onSelect={item => {
              setShielded(item.value === 'shielded');
              setStep('contract');
            }}
          />
        </Box>
      )}

      {step === 'contract' && (
        <Box gap={1}>
          <Text>Contract address: </Text>
          <TextInput
            value={contractAddress}
            onChange={setContractAddress}
            onSubmit={() => setStep('recipient')}
            placeholder="0x…"
          />
        </Box>
      )}

      {step === 'recipient' && (
        <Box gap={1}>
          <Text>Recipient: </Text>
          <TextInput
            value={recipient}
            onChange={setRecipient}
            onSubmit={() => setStep('amount')}
            placeholder={shielded ? 'shielded address' : '0x…'}
          />
        </Box>
      )}

      {step === 'amount' && (
        <Box gap={1}>
          <Text>Amount: </Text>
          <TextInput
            value={amount}
            onChange={setAmount}
            onSubmit={() => setStep('confirm')}
            placeholder="0.000000"
          />
        </Box>
      )}

      {step === 'confirm' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm mint</Text>
          <Text dimColor>Contract  <Text color="white">{contractAddress}</Text></Text>
          <Text dimColor>Recipient <Text color="white">{recipient}</Text></Text>
          <Text dimColor>Amount    <Text color="white">{amount}</Text></Text>
          <Text dimColor>Shielded  <Text color="white">{String(shielded)}</Text></Text>
          <SelectInput
            items={[
              {label: 'Confirm', value: 'confirm'},
              {label: 'Cancel',  value: 'cancel'},
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
