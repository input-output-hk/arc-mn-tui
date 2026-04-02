import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import TextInput   from 'ink-text-input';
import SelectInput from 'ink-select-input';
import TxStatusComponent from '../components/TxStatus.js';
import DustMonitor       from '../components/DustMonitor.js';
import {useDust}         from '../hooks/useDust.js';
import type {WalletSyncState} from '../hooks/useWalletSync.js';
import {useInputMode} from '../hooks/useInputMode.js';

type Step = 'view' | 'amount' | 'confirm' | 'submitting';

interface Props {
  onComplete:  () => void;
  walletSync:  WalletSyncState;
}

export default function Designate({onComplete, walletSync}: Props) {
  const {txStatus, designate} = useDust();

  const [step,   setStep]   = useState<Step>('view');
  const [amount, setAmount] = useState('');

  const {setInputActive} = useInputMode();
  useEffect(() => {
    setInputActive(step === 'amount');
    return () => setInputActive(false);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    setStep('submitting');
    // TODO: call the DUST pallet's designate extrinsic via the wallet SDK.
    //   Suggested approach:
    //     wallet.palletCall('dust', 'designate', { amount: parsedAmount })
    await designate({nightAmount: amount});
  }

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" gap={1}>
        <TxStatusComponent status={txStatus} />
        {txStatus.stage === 'confirmed' && (
          <Text color="green">Designation confirmed. Press 1 to return to dashboard.</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Designate NIGHT for DUST Generation</Text>

      <DustMonitor
        balance={walletSync.balances?.dust ?? null}
        generation={walletSync.balances?.dustGeneration ?? null}
      />

      {step === 'view' && (
        <SelectInput
          items={[
            {label: 'Designate more NIGHT', value: 'designate'},
            {label: 'Back to dashboard',    value: 'back'},
          ]}
          onSelect={item => {
            if (item.value === 'designate') setStep('amount');
            else onComplete();
          }}
        />
      )}

      {step === 'amount' && (
        <Box gap={1}>
          <Text>NIGHT to designate: </Text>
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
          <Text bold>Confirm designation</Text>
          <Text dimColor>
            Designate <Text color="white">{amount} NIGHT</Text> for DUST generation
          </Text>
          <Text dimColor>
            This NIGHT will be locked until you undesignate it.
          </Text>
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
