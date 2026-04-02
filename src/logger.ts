import {appendFileSync, readFileSync, writeFileSync} from 'fs';

// ---------------------------------------------------------------------------
// Singleton logger — writes timestamped lines to a file.
// The log path can be changed at runtime via setPath().
// ---------------------------------------------------------------------------

type Level = 'info' | 'warn' | 'error';

class Logger {
  private path = 'mn-tui.log';

  /** Cumulative count of warn/error calls since startup or last clear(). */
  issueCount = 0;

  getPath(): string { return this.path; }

  setPath(p: string) { this.path = p; }

  private write(level: Level, msg: string) {
    const ts   = new Date().toISOString();
    const line = `${ts} [${level.toUpperCase()}] ${msg}\n`;
    try {
      appendFileSync(this.path, line, 'utf8');
    } catch {
      // swallow — we never want logging to crash the TUI
    }
  }

  info (msg: string) { this.write('info',  msg); }
  warn (msg: string) { this.issueCount++; this.write('warn',  msg); }
  error(msg: string) { this.issueCount++; this.write('error', msg); }

  /** Read the last `n` lines of the log file. */
  tail(n = 200): string[] {
    try {
      const raw   = readFileSync(this.path, 'utf8');
      const lines = raw.split('\n').filter(l => l.length > 0);
      return lines.slice(-n);
    } catch {
      return [];
    }
  }

  /** Truncate / clear the log file and reset the issue counter. */
  clear() {
    try { writeFileSync(this.path, '', 'utf8'); } catch { /* swallow */ }
    this.issueCount = 0;
  }
}

export const logger = new Logger();
