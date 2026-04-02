import React, {useState, useEffect} from 'react';
import {Box, Text, useInput}         from 'ink';
import SelectInput                   from 'ink-select-input';
import TxStatusComponent             from '../components/TxStatus.js';
import DustMonitor                   from '../components/DustMonitor.js';
import type {WalletSyncState}        from '../hooks/useWalletSync.js';

type Step = 'view' | 'confirm' | 'submitting';

interface Props {
  onComplete: () => void;
  walletSync: WalletSyncState;
}

export default function Designate({onComplete, walletSync}: Props) {
  const {balances, designateTxStatus, designate, resetDesignate} = walletSync;

  const [step, setStep] = useState<Step>('view');

  useEffect(() => { resetDesignate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((_, key) => {
    if (step === 'submitting') {
      if ((designateTxStatus.stage === 'pending' || designateTxStatus.stage === 'failed') && key.return) {
        onComplete();
      }
      return;
    }
    if (key.escape && step === 'confirm') setStep('view');
  });

  async function handleConfirm() {
    setStep('submitting');
    await designate();
  }

  const unregistered = balances?.unregisteredNightUtxos ?? 0;

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="cyan">Designate NIGHT for DUST Generation</Text>
        <TxStatusComponent status={designateTxStatus} />
        {(designateTxStatus.stage === 'pending' || designateTxStatus.stage === 'failed') && (
          <Text dimColor>Press Enter to return to dashboard.</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Designate NIGHT for DUST Generation</Text>

      <DustMonitor
        balance={balances?.dust ?? null}
        generation={balances?.dustGeneration ?? null}
      />

      {step === 'view' && (
        <Box flexDirection="column" gap={1}>
          {unregistered === 0 ? (
            <Text dimColor>All NIGHT UTXOs are already registered for DUST generation.</Text>
          ) : (
            <Text dimColor>
              {unregistered} NIGHT UTXO{unregistered !== 1 ? 's' : ''} not yet registered.
            </Text>
          )}
          <SelectInput
            items={[
              ...(unregistered > 0
                ? [{label: `Register ${unregistered} UTXO${unregistered !== 1 ? 's' : ''} for DUST`, value: 'designate'}]
                : []),
              {label: 'Back to dashboard', value: 'back'},
            ]}
            onSelect={item => {
              if (item.value === 'designate') setStep('confirm');
              else onComplete();
            }}
          />
        </Box>
      )}

      {step === 'confirm' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm registration</Text>
          <Text dimColor>
            Register <Text color="white">{unregistered} NIGHT UTXO{unregistered !== 1 ? 's' : ''}</Text> for DUST generation.
          </Text>
          <Text dimColor>UTXOs remain in your wallet but are designated to accrue DUST.</Text>
          <SelectInput
            items={[
              {label: 'Register', value: 'confirm'},
              {label: 'Cancel',   value: 'cancel'},
            ]}
            onSelect={item => {
              if (item.value === 'confirm') void handleConfirm();
              else setStep('view');
            }}
          />
          <Text dimColor>[Esc] back</Text>
        </Box>
      )}
    </Box>
  );
}
