#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import App from './App.js';

// Enter alternate screen buffer (fullscreen) then render.
process.stdout.write('\x1b[?1049h\x1b[H');
render(<App />, {exitOnCtrlC: true});
process.on('exit', () => process.stdout.write('\x1b[?1049l'));
