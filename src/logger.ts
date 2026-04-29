import {appendFileSync, readFileSync, writeFileSync} from 'fs';

// ---------------------------------------------------------------------------
// Singleton logger — writes one NDJSON line per entry to a file.
// The log path can be changed at runtime via setPath().
// The Logs screen calls tail() to get structured LogEntry objects for
// human-readable display; the raw file is machine-readable NDJSON.
// ---------------------------------------------------------------------------

/**
 * Recursively descend through an Effect-serialized Cause/FiberFailure tree
 * (plain JS objects from JSON.parse) and collect all distinct human-readable
 * messages so that deeply-nested RPC errors surface in the log's cause chain.
 */
function collectEffectMessages(node: unknown, out: string[], seen: Set<unknown>, depth = 0): void {
  if (depth > 10 || node == null || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  const o = node as Record<string, unknown>;

  if (o._id === 'FiberFailure') {
    // Unwrap: the Effect Cause is in `cause`
    collectEffectMessages(o.cause, out, seen, depth + 1);
    return;
  }
  if (o._id === 'Cause') {
    // Unwrap: the actual error is in `failure` (Fail) or `defect` (Die)
    collectEffectMessages(o.failure ?? o.defect, out, seen, depth + 1);
    return;
  }

  // Leaf error node — extract message, code, data
  const parts: string[] = [];
  if (typeof o.message === 'string' && o.message) parts.push(o.message);
  if (o.code != null)                              parts.push(`code=${String(o.code)}`);
  if (typeof o.data   === 'string' && o.data)      parts.push(`data=${o.data}`);
  else if (o.data != null)                         parts.push(`data=${JSON.stringify(o.data)}`);
  if (typeof o._tag   === 'string' && !parts.length) parts.push(`[${o._tag}]`);
  if (parts.length) out.push(parts.join(' '));

  // Keep descending into a nested `cause` if present
  collectEffectMessages(o.cause, out, seen, depth + 1);
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  ts:      string;
  level:   LogLevel;
  msg:     string;
  cause?:  string;   // error.message chain joined with →
  stack?:  string;   // error.stack when the cause is an Error object
  detail?: string;   // JSON of any extra enumerable properties on errors in the cause chain
}

class Logger {
  private path = 'mn-tui.log';

  /** Cumulative count of all log lines since startup or last clear(). */
  lineCount = 0;
  /** Cumulative count of warn/error calls since startup or last clear(). */
  issueCount = 0;

  getPath(): string { return this.path; }

  setPath(p: string) { this.path = p; }

  private write(level: LogLevel, msg: string, cause?: unknown) {
    const entry: LogEntry = {ts: new Date().toISOString(), level, msg};
    if (cause != null) {
      // --- detail: full serialization via toJSON (captures Effect FiberFailure structure) ---
      try {
        const json = JSON.stringify(cause);
        if (json && json !== '{}' && json !== 'null') entry.detail = json;
      } catch {
        // Circular reference — fall back to enumerating own property names.
        try {
          const flat: Record<string, unknown> = {};
          for (const key of Object.getOwnPropertyNames(cause)) {
            if (key !== 'stack') {
              try { flat[key] = (cause as any)[key]; } catch { /* skip */ }
            }
          }
          entry.detail = JSON.stringify(flat);
        } catch { /* give up */ }
      }

      // --- cause chain: walk standard .cause AND Effect Cause tree ---
      const chain: string[] = [];
      const seen = new Set<unknown>();
      let node: unknown = cause;
      while (node != null && !seen.has(node)) {
        seen.add(node);
        if (node instanceof Error) {
          chain.push(node.message);
        } else if (typeof node === 'object') {
          // Effect Cause node: { _id: 'Cause', _tag: 'Fail'|'Die', failure|defect }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const effectId = (node as any)._id;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const effectTag = (node as any)._tag;
          if (effectId === 'Cause') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            node = (node as any).failure ?? (node as any).defect ?? null;
            continue;
          }
          // Tagged Effect error or plain object with a message
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = (node as any).message;
          chain.push(m != null ? String(m) : effectTag ? `[${effectTag}]` : String(node));
        } else {
          chain.push(String(node));
        }
        // Standard .cause (also used by Effect TaggedError to embed the underlying error)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const next = (node as any).cause;
        if (next == null || next === node) break;
        node = next;
      }
      // Supplement the chain with any messages buried inside Effect's Cause tree.
      // These are not reachable via standard .cause but are visible in the serialized JSON.
      if (entry.detail) {
        try {
          const effectSeen = new Set<unknown>();
          const extras: string[] = [];
          collectEffectMessages(JSON.parse(entry.detail), extras, effectSeen);
          for (const m of extras) {
            if (!chain.includes(m)) chain.push(m);
          }
        } catch { /* skip */ }
      }

      if (chain.length > 0) entry.cause = chain.join(' → ');
      if (cause instanceof Error && cause.stack) entry.stack = cause.stack;
    }
    try {
      appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf8');
      this.lineCount++;
    } catch {
      // swallow — we never want logging to crash the TUI
    }
  }

  info (msg: string)                    { this.write('INFO',  msg); }
  warn (msg: string, cause?: unknown)   { this.issueCount++; this.write('WARN',  msg, cause); }
  error(msg: string, cause?: unknown)   { this.issueCount++; this.write('ERROR', msg, cause); }

  /** Read the last `n` log entries as parsed LogEntry objects. */
  tail(n = 200): LogEntry[] {
    try {
      const raw   = readFileSync(this.path, 'utf8');
      const lines = raw.split('\n').filter(l => l.length > 0);
      return lines.slice(-n).map(l => {
        try {
          return JSON.parse(l) as LogEntry;
        } catch {
          // Legacy plain-text line — wrap it so the screen can still render it.
          return {ts: '', level: 'INFO' as LogLevel, msg: l};
        }
      });
    } catch {
      return [];
    }
  }

  /** Truncate / clear the log file and reset counters. */
  clear() {
    try { writeFileSync(this.path, '', 'utf8'); } catch { /* swallow */ }
    this.lineCount  = 0;
    this.issueCount = 0;
  }
}

export const logger = new Logger();
