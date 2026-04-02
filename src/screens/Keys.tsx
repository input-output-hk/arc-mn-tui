import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import {useWallet} from '../hooks/useWallet.js';

type Step = 'input' | 'results';

export default function Keys() {
  const {connect, deriveAddresses} = useWallet();

  const [step,      setStep]      = useState<Step>('input');
  const [mnemonic,  setMnemonic]  = useState('');
  const [countStr,  setCountStr]  = useState('3');
  const [addresses, setAddresses] = useState<
    {index: number; shielded: string; unshielded: string}[]
  >([]);

  async function handleSubmit() {
    const count = Math.max(1, parseInt(countStr, 10) || 1);
    // TODO: replace stubs with real derivation.
    //   For Midnight:
    //     - Parse mnemonic using a BIP-39 library.
    //     - Derive spending keys and viewing keys using the Midnight SDK key
    //       derivation API (separate from NEAR's Ed25519 hardened paths).
    //     - Derive unshielded address (sr25519 / ss58 encoded).
    //     - Derive shielded address (Midnight-specific encoding).
    await connect(mnemonic);
    const derived = deriveAddresses(mnemonic, count);
    setAddresses(derived);
    setStep('results');
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">Key Derivation</Text>

      {step === 'input' && (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text>Mnemonic: </Text>
            <TextInput
              value={mnemonic}
              onChange={setMnemonic}
              onSubmit={() => { /* move to count field */ }}
              mask="*"
              placeholder="word1 word2 … word24"
            />
          </Box>
          <Box gap={1}>
            <Text>Address count: </Text>
            <TextInput
              value={countStr}
              onChange={setCountStr}
              onSubmit={handleSubmit}
              placeholder="3"
            />
          </Box>
          <Text dimColor>Press Enter on the count field to derive.</Text>
        </Box>
      )}

      {step === 'results' && (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>Mnemonic accepted. Derived {addresses.length} address(es):</Text>
          {addresses.map(a => (
            <Box key={a.index} flexDirection="column">
              <Text bold>Index {a.index}</Text>
              <Text dimColor>  Unshielded  <Text color="white">{a.unshielded}</Text></Text>
              <Text dimColor>  Shielded    <Text color="white">{a.shielded}</Text></Text>
            </Box>
          ))}
          <Text dimColor>Press 1 to return to dashboard.</Text>
        </Box>
      )}
    </Box>
  );
}
