import React, {useState} from 'react';
import {Box, Text, useApp} from 'ink';
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
import {loadConfig, saveConfig} from './config.js';

export default function App() {
  const {exit} = useApp();

  const [screen,  setScreen]  = useState<Screen>('dashboard');
  const [network, setNetwork] = useState<NetworkConfig>(() => loadConfig().network);

  const navigate   = (s: Screen) => setScreen(s);
  const toDash     = () => setScreen('dashboard');
  const applyNetwork = (cfg: NetworkConfig) => {
    setNetwork(cfg);
    saveConfig({network: cfg});
  };

  return (
    <Box flexDirection="column">

      {/* Title bar */}
      <Box borderStyle="single" paddingX={1} justifyContent="space-between">
        <Box gap={2}>
          <Text bold color="cyan">Midnight TUI</Text>
          <Text dimColor>|</Text>
          <Text color="yellow">{network.name}</Text>
        </Box>
        <Text dimColor>q — exit</Text>
      </Box>

      {/* Navigation */}
      <NavMenu current={screen} onNavigate={navigate} onExit={exit} />

      {/* Active screen */}
      <Box paddingX={2} paddingY={1}>
        {screen === 'network'   && (
          <Network
            current={network}
            onSave={applyNetwork}
            onComplete={toDash}
          />
        )}
        {screen === 'dashboard' && <Dashboard network={network} />}
        {screen === 'send'      && <Send      onComplete={toDash} />}
        {screen === 'mint'      && <Mint      onComplete={toDash} />}
        {screen === 'deploy'    && <Deploy    onComplete={toDash} />}
        {screen === 'keys'      && <Keys />}
        {screen === 'designate' && <Designate onComplete={toDash} />}
        {screen === 'logs'      && <Logs />}
      </Box>

    </Box>
  );
}
