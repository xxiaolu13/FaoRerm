import { Terminal } from "xterm";

class TerminalManager {
  private terminals = new Map<string, Terminal>();
  private channelToTab = new Map<string, string>();
  private pendingOutput = new Map<string, Uint8Array[]>();

  register(tabId: string, terminal: Terminal): void {
    this.terminals.set(tabId, terminal);

    const pending = this.pendingOutput.get(tabId);
    if (pending) {
      for (const data of pending) {
        terminal.write(data);
      }
      this.pendingOutput.delete(tabId);
    }
  }

  unregister(tabId: string): void {
    this.terminals.delete(tabId);
    for (const [chId, tId] of this.channelToTab) {
      if (tId === tabId) this.channelToTab.delete(chId);
    }
    this.pendingOutput.delete(tabId);
  }

  setChannelId(tabId: string, channelId: string): void {
    this.channelToTab.set(channelId, tabId);
    const pending = this.pendingOutput.get(channelId);
    if (pending) {
      const term = this.terminals.get(tabId);
      if (term) {
        for (const data of pending) term.write(data);
      }
      this.pendingOutput.delete(channelId);
    }
  }

  writeByChannel(channelId: string, data: Uint8Array): void {
    const tabId = this.channelToTab.get(channelId);
    if (tabId) {
      const term = this.terminals.get(tabId);
      if (term) {
        term.write(data);
        return;
      }
    }
    const buffered = this.pendingOutput.get(channelId) || [];
    buffered.push(data);
    this.pendingOutput.set(channelId, buffered);
  }

  write(tabId: string, data: Uint8Array): void {
    const term = this.terminals.get(tabId);
    if (term) {
      term.write(data);
      return;
    }
    const buffered = this.pendingOutput.get(tabId) || [];
    buffered.push(data);
    this.pendingOutput.set(tabId, buffered);
  }

  getTabIdByChannel(channelId: string): string | undefined {
    return this.channelToTab.get(channelId);
  }

  focus(tabId: string): void {
    this.terminals.get(tabId)?.focus();
  }

  getTerminal(tabId: string): Terminal | undefined {
    return this.terminals.get(tabId);
  }
}

export const terminalManager = new TerminalManager();
