import { desktopSchema, windowSchema, type Desktop, type Window } from './contracts';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export interface Computer {
  desktop(): Promise<Desktop>;
  window(pid: number, windowId: number): Promise<Window>;
  launchApp(name: string): Promise<void>;
  clickElement(pid: number, windowId: number, elementToken: string): Promise<void>;
  typeText(pid: number, windowId: number, elementToken: string, text: string): Promise<void>;
  pressKey(pid: number, windowId: number, key: string, modifiers: string[]): Promise<void>;
}

export class CuaMcpComputer implements Computer {
  private readonly client = new Client({ name: 'system-one-computer-use', version: '0.1.0' });
  private connected?: Promise<void>;
  constructor(private readonly binary = 'cua-driver') {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.connected ??= this.client.connect(new StdioClientTransport({ command: this.binary, args: ['mcp'] }));
    await this.connected;
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) {
      const detail = result.content?.filter(item => item.type === 'text').map(item => item.text).join(' ') || 'unknown error';
      throw new Error(`Cua ${name} failed: ${detail.slice(0, 800)}`);
    }
    if (!result.structuredContent) throw new Error(`Cua ${name} returned no structured result`);
    return result.structuredContent;
  }

  async close(): Promise<void> {
    if (this.connected) await this.client.close();
  }

  async desktop(): Promise<Desktop> {
    return desktopSchema.parse(await this.call('get_accessibility_tree', {}));
  }

  async window(pid: number, windowId: number): Promise<Window> {
    return windowSchema.parse(await this.call('get_window_state', {
      pid, window_id: windowId, include_screenshot: false, max_elements: 150,
    }));
  }

  async launchApp(name: string): Promise<void> {
    await this.call('launch_app', { name });
  }

  async clickElement(pid: number, windowId: number, elementToken: string): Promise<void> {
    await this.call('click', { pid, window_id: windowId, element_token: elementToken });
  }

  async typeText(pid: number, windowId: number, elementToken: string, text: string): Promise<void> {
    await this.call('type_text', { pid, window_id: windowId, element_token: elementToken, text });
  }

  async pressKey(pid: number, windowId: number, key: string, modifiers: string[]): Promise<void> {
    await this.call('press_key', { pid, window_id: windowId, key, modifiers });
  }
}
