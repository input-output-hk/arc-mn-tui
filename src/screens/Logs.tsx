import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {logger}  from '../logger.js';
import {useInputMode} from '../hooks/useInputMode.js';

type Mode = 'view' | 'rename';

export default function Logs() {
  const [mode,    setMode]    = useState<Mode>('view');
  const [lines,   setLines]   = useState<string[]>([]);
  const [draft,   setDraft]   = useState(logger.getPath());
  const [message, setMessage] = useState('');

  const {setInputActive} = useInputMode();
  useEffect(() => {
    setInputActive(mode === 'rename');
    return () => setInputActive(false);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh log lines on mount and whenever we return to view mode.
  useEffect(() => {
    if (mode === 'view') setLines(logger.tail(40));
  }, [mode]);

  // Poll for new lines every 2 s while in view mode.
  useEffect(() => {
    if (mode !== 'view') return;
    const id = setInterval(() => setLines(logger.tail(40)), 2_000);
    return () => clearInterval(id);
  }, [mode]);

  useInput((input, key) => {
    if (mode !== 'view') return;
    if (input === 'r') { setDraft(logger.getPath()); setMode('rename'); }
    if (input === 'c') {
      logger.clear();
      setLines([]);
      setMessage('Log cleared.');
      setTimeout(() => setMessage(''), 2_000);
    }
  });

  function commitRename(value: string) {
    const trimmed = value.trim();
    if (trimmed) {
      logger.setPath(trimmed);
      setMessage(`Log path set to "${trimmed}".`);
      setTimeout(() => setMessage(''), 3_000);
    }
    setMode('view');
  }

  return (
    <Box flexDirection="column" gap={1}>

      <Box gap={2}>
        <Text bold color="cyan">Logs</Text>
        <Text dimColor>{logger.getPath()}</Text>
      </Box>

      {mode === 'rename' ? (
        <Box gap={1}>
          <Text>New path: </Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={commitRename}
          />
        </Box>
      ) : (
        <Text dimColor>[r] rename log file  [c] clear log</Text>
      )}

      {message && <Text color="green">{message}</Text>}

      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {lines.length === 0
          ? <Text dimColor>(log is empty)</Text>
          : lines.map((l, i) => {
              const color = l.includes('[ERROR]') ? 'red'
                          : l.includes('[WARN]')  ? 'yellow'
                          : undefined;
              return <Text key={i} color={color} wrap="truncate">{l}</Text>;
            })
        }
      </Box>

    </Box>
  );
}
