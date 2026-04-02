import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import TextInput   from 'ink-text-input';
import SelectInput from 'ink-select-input';
import TxStatusComponent from '../components/TxStatus.js';
import {useWallet} from '../hooks/useWallet.js';
import type {DeployParams} from '../types.js';
import {useInputMode} from '../hooks/useInputMode.js';

type Step = 'path' | 'args' | 'confirm' | 'submitting';

interface Props {
  onComplete: () => void;
}

export default function Deploy({onComplete}: Props) {
  const {txStatus} = useWallet();

  const [step,         setStep]         = useState<Step>('path');
  const [contractPath, setContractPath] = useState('');
  const [initArgs,     setInitArgs]     = useState('');

  const {setInputActive} = useInputMode();
  useEffect(() => {
    setInputActive(step === 'path' || step === 'args');
    return () => setInputActive(false);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    setStep('submitting');
    const _params: DeployParams = {contractPath, initArgs};
    // TODO: deploy contract via the Midnight SDK.
    //   Suggested approach:
    //     1. Read the compiled contract bytecode from contractPath.
    //     2. Parse initArgs as JSON or a simple key=value string.
    //     3. Call wallet.deployContract(bytecode, initArgs) which submits a
    //        DeployTx and returns the deployed contract address.
    await new Promise(r => setTimeout(r, 5_000)); // stub: proof generation + deploy
    void _params;
  }

  if (step === 'submitting') {
    return (
      <Box flexDirection="column" gap={1}>
        <TxStatusComponent status={txStatus} />
        {txStatus.stage === 'confirmed' && (
          <Box flexDirection="column">
            <Text color="green">Contract deployed.</Text>
            <Text dimColor>
              {/* TODO: display the deployed contract address from txStatus */}
              Address: 0xSTUB_CONTRACT_ADDRESS
            </Text>
            <Text dimColor>Press Enter to return to dashboard</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Deploy Contract</Text>

      {step === 'path' && (
        <Box gap={1}>
          <Text>Contract file path: </Text>
          <TextInput
            value={contractPath}
            onChange={setContractPath}
            onSubmit={() => setStep('args')}
            placeholder="/path/to/contract.compact"
          />
        </Box>
      )}

      {step === 'args' && (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Contract: <Text color="white">{contractPath}</Text></Text>
          <Box gap={1}>
            <Text>Init arguments (JSON): </Text>
            <TextInput
              value={initArgs}
              onChange={setInitArgs}
              onSubmit={() => setStep('confirm')}
              placeholder='{}'
            />
          </Box>
        </Box>
      )}

      {step === 'confirm' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm deployment</Text>
          <Text dimColor>File <Text color="white">{contractPath}</Text></Text>
          <Text dimColor>Args <Text color="white">{initArgs || '{}'}</Text></Text>
          <SelectInput
            items={[
              {label: 'Deploy', value: 'deploy'},
              {label: 'Cancel', value: 'cancel'},
            ]}
            onSelect={item => {
              if (item.value === 'deploy') handleConfirm();
              else onComplete();
            }}
          />
        </Box>
      )}
    </Box>
  );
}
