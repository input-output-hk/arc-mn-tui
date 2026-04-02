import React, {useState, useEffect} from 'react';
import {Box, Text, useApp, useStdout, useInput} from 'ink';
import NavMenu   from './components/NavMenu.js';
import Dashboard from './screens/Dashboard.js';
import Network   from './screens/Network.js';
import Send      from './screens/Send.js';
import Mint      from './screens/Mint.js';
import Deploy    from './screens/Deploy.js';
import Keys      from './screens/Keys.js';
import Designate from './screens/Designate.js';
import Logs      from './screens/Logs.js';
import type {Screen, NetworkConfig} from './types.js';
import {loadConfig, saveConfig}    from './config.js';
import {useWallet}                  from './hooks/useWallet.js';
import {useWalletSync}              from './hooks/useWalletSync.js';
import {logger}                    from './logger.js';
import pkg                         from '../package.json';

export default function App() {
  const {exit}   = useApp();
  const {stdout} = useStdout();

  const [screen,            setScreen]           = useState<Screen>('dashboard');
  const [network,           setNetwork]          = useState<NetworkConfig>(() => loadConfig().network);
  const [paused,            setPaused]           = useState(false);
  const [issueCount,        setIssueCount]       = useState(() => logger.issueCount);
  const [lastSeenIssueCount, setLastSeenIssueCount] = useState(() => logger.issueCount);

  const {activeIndex, getMnemonic} = useWallet();
  const mnemonic   = getMnemonic(activeIndex);
  const walletSync = useWalletSync(mnemonic, network, paused);

  // Poll for new log issues every 5 s; only updates state when count actually changes.
  useEffect(() => {
    const id = setInterval(() => {
      const n = logger.issueCount;
      setIssueCount(prev => prev === n ? prev : n);
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  useInput((input) => {
    if (input === 'q') { exit(); return; }
    if (input === 'p') { setPaused(p => !p); return; }
  });

  const navigate = (s: Screen) => {
    if (s === 'logs') setLastSeenIssueCount(logger.issueCount);
    setScreen(s);
  };
  const toDash     = () => navigate('dashboard');
  const applyNetwork = (cfg: NetworkConfig) => {
    setNetwork(cfg);
    saveConfig({...loadConfig(), network: cfg});
  };

  return (
    <Box flexDirection="column" height={stdout.rows}>

      {/* Title bar */}
      <Box borderStyle="single" paddingX={1} justifyContent="space-between">
        <Box gap={2}>
          <Text bold color="cyan">Midnight TUI</Text>
          <Text dimColor>v{pkg.version}</Text>
          <Text dimColor>|</Text>
          <Text color="yellow">{network.name}</Text>
        </Box>
        <Box gap={2}>
          {paused && <Text color="yellow">PAUSED</Text>}
          <Text dimColor>p — {paused ? 'resume' : 'pause'}  q — exit</Text>
        </Box>
      </Box>

      {/* Navigation */}
      <NavMenu current={screen} onNavigate={navigate} hasNewLogs={issueCount > lastSeenIssueCount} />

      {/* Active screen */}
      <Box paddingX={2} paddingY={1} flexGrow={1}>
        {screen === 'network'   && (
          <Network
            current={network}
            onSave={applyNetwork}
            onComplete={toDash}
          />
        )}
        {screen === 'dashboard' && <Dashboard network={network} paused={paused} walletSync={walletSync} />}
        {screen === 'send'      && <Send      onComplete={toDash} />}
        {screen === 'mint'      && <Mint      onComplete={toDash} />}
        {screen === 'deploy'    && <Deploy    onComplete={toDash} />}
        {screen === 'keys'      && <Keys network={network} />}
        {screen === 'designate' && <Designate onComplete={toDash} walletSync={walletSync} />}
        {screen === 'logs'      && <Logs />}
      </Box>

      {/* Footer */}
      <Box justifyContent="center">
        <Text color="yellow" bold>⚠️  Only minimal quality assurance has been performed on this app.  ⚠️</Text>
      </Box>

    </Box>
  );
}
