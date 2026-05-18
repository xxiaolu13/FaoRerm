import { Terminal } from "xterm";

class TerminalManager {
  private terminals = new Map<string, Terminal>();
  private pendingOutput = new Map<string, Uint8Array[]>();

  register(sessionId: string, terminal: Terminal): void {
    this.terminals.set(sessionId, terminal);

    // Flush any pending output
    const pending = this.pendingOutput.get(sessionId);
    if (pending) {
      for (const data of pending) {
        terminal.write(data);
      }
      this.pendingOutput.delete(sessionId);
    }
  }

  unregister(sessionId: string): void {
    const term = this.terminals.get(sessionId);
    if (term) {
      term.dispose();
      this.terminals.delete(sessionId);
    }
    this.pendingOutput.delete(sessionId);
  }

  write(sessionId: string, data: Uint8Array): void {
    const term = this.terminals.get(sessionId);
    if (term) {
      term.write(data);
    } else {
      // Buffer output until terminal is registered
      const buffered = this.pendingOutput.get(sessionId) || [];
      buffered.push(data);
      this.pendingOutput.set(sessionId, buffered);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const term = this.terminals.get(sessionId);
    if (term) {
      term.resize(cols, rows);
    }
  }

  focus(sessionId: string): void {
    const term = this.terminals.get(sessionId);
    if (term) {
      term.focus();
    }
  }
}

export const terminalManager = new TerminalManager();
