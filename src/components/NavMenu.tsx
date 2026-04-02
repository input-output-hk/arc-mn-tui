import React from 'react';
import {Box, Text, useInput} from 'ink';
import type {Screen} from '../types.js';

const SCREEN_ITEMS: {key: string; label: string; screen: Screen}[] = [
  {key: '0', label: 'Network',   screen: 'network'},
  {key: '1', label: 'Dashboard', screen: 'dashboard'},
  {key: '2', label: 'Send',      screen: 'send'},
  {key: '3', label: 'Mint',      screen: 'mint'},
  {key: '4', label: 'Deploy',    screen: 'deploy'},
  {key: '5', label: 'Keys',      screen: 'keys'},
  {key: '6', label: 'Designate', screen: 'designate'},
  {key: '7', label: 'Logs',      screen: 'logs'},
];

interface Props {
  current:    Screen;
  onNavigate: (screen: Screen) => void;
  onExit:     () => void;
}

export default function NavMenu({current, onNavigate, onExit}: Props) {
  useInput((input) => {
    if (input === 'q') { onExit(); return; }
    const item = SCREEN_ITEMS.find(i => i.key === input);
    if (item) onNavigate(item.screen);
  });

  return (
    <Box borderStyle="single" paddingX={1} gap={2} flexWrap="wrap">
      {SCREEN_ITEMS.map(({key, label, screen}) => (
        <Text
          key={screen}
          bold={current === screen}
          color={current === screen ? 'cyan' : undefined}
          dimColor={current !== screen}
        >
          [{key}] {label}
        </Text>
      ))}
      <Text dimColor>[q] Exit</Text>
    </Box>
  );
}
