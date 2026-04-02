import React from 'react';
import {Box, Text, useInput} from 'ink';
import type {Screen} from '../types.js';

const SCREEN_ITEMS: {key: string; label: string; screen: Screen}[] = [
  {key: '0', label: 'Network',   screen: 'network'},
  {key: '1', label: 'Dashboard', screen: 'dashboard'},
  {key: '2', label: 'Send',      screen: 'send'},
  {key: '3', label: 'Deploy',    screen: 'deploy'},
  {key: '4', label: 'Mint',      screen: 'mint'},
  {key: '5', label: 'Designate', screen: 'designate'},
  {key: '6', label: 'Keys',      screen: 'keys'},
  {key: '7', label: 'Logs',      screen: 'logs'},
];

interface Props {
  current:      Screen;
  onNavigate:   (screen: Screen) => void;
  hasNewLogs:   boolean;
  menuActive:   boolean;
  onMenuToggle: () => void;
}

export default function NavMenu({current, onNavigate, hasNewLogs, menuActive, onMenuToggle}: Props) {
  useInput((input) => {
    if (/^[0-7]$/.test(input)) {
      onNavigate(SCREEN_ITEMS[parseInt(input, 10)].screen);
      onMenuToggle();
    }
  }, {isActive: menuActive});

  return (
    <Box
      borderStyle="single"
      borderColor={menuActive ? 'cyan' : undefined}
      paddingX={1}
      gap={2}
      flexWrap="wrap"
    >
      {SCREEN_ITEMS.map(({key, label, screen}) => (
        <Box key={screen} gap={0}>
          <Text
            bold={current === screen}
            color={current === screen ? 'cyan' : undefined}
            dimColor={current !== screen}
          >
            {key}:{label}
          </Text>
          {screen === 'logs' && hasNewLogs && current !== 'logs' && (
            <Text color="yellow"> ●</Text>
          )}
        </Box>
      ))}
      <Text dimColor>{menuActive ? '[0-7 navigate]' : '[M-m]'}</Text>
    </Box>
  );
}
