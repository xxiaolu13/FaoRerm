import { Terminal } from "xterm";

const CSI_2J = "\x1b[2J";
const CSI_3J = "\x1b[3J";
const CSI_Q3J = "\x1b[?3J";

function processClearSequence(text: string, rows: number): string {
  let result = text;

  result = result.split(CSI_Q3J).join("");
  result = result.split(CSI_3J).join("");

  if (rows > 0 && result.includes(CSI_2J)) {
    const scroll = `\x1b[${rows};1H${"\n".repeat(rows)}\x1b[H`;
    result = result.split(CSI_2J).join(`${scroll}${CSI_2J}`);
  }

  return result;
}

class TerminalManager {
  private terminals = new Map<string, Terminal>();
  private channelToTab = new Map<string, string>();
  private pendingOutput = new Map<string, Uint8Array[]>();

  private writeToTerminal(term: Terminal, data: Uint8Array): void {
    const text = new TextDecoder().decode(data);

    if (!text.includes(CSI_2J) && !text.includes(CSI_3J) && !text.includes(CSI_Q3J)) {
      term.write(data);
      return;
    }

    const processed = processClearSequence(text, term.rows);
    if (processed.length === 0) return;
    term.write(new TextEncoder().encode(processed));
  }

  register(tabId: string, terminal: Terminal): void {
    this.terminals.set(tabId, terminal);

    const pending = this.pendingOutput.get(tabId);
    if (pending) {
      for (const data of pending) {
        this.writeToTerminal(terminal, data);
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
        for (const data of pending) this.writeToTerminal(term, data);
      }
      this.pendingOutput.delete(channelId);
    }
  }

  writeByChannel(channelId: string, data: Uint8Array): void {
    const tabId = this.channelToTab.get(channelId);
    if (tabId) {
      const term = this.terminals.get(tabId);
      if (term) {
        this.writeToTerminal(term, data);
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
      this.writeToTerminal(term, data);
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
