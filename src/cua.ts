import { desktopSchema, windowSchema, type Desktop, type Window } from './contracts';

export interface Computer {
  desktop(): Promise<Desktop>;
  window(pid: number, windowId: number): Promise<Window>;
  launchApp(name: string): Promise<void>;
  clickElement(pid: number, windowId: number, elementToken: string): Promise<void>;
  typeText(pid: number, windowId: number, elementToken: string, text: string): Promise<void>;
  pressKey(pid: number, windowId: number, key: string, modifiers: string[]): Promise<void>;
}

export class CuaCliComputer implements Computer {
  constructor(private readonly binary = 'cua-driver', private readonly session = 'system-one-computer-use') {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const child = Bun.spawn([this.binary, 'call', name, JSON.stringify(args)], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`Cua ${name} failed: ${(err || out).trim().slice(0, 800)}`);
    try { return JSON.parse(out); }
    catch { throw new Error(`Cua ${name} returned invalid JSON: ${out.slice(0, 300)}`); }
  }

  async desktop(): Promise<Desktop> {
    return desktopSchema.parse(await this.call('get_accessibility_tree', {}));
  }

  async window(pid: number, windowId: number): Promise<Window> {
    return windowSchema.parse(await this.call('get_window_state', {
      pid, window_id: windowId, include_screenshot: false, max_elements: 150, session: this.session,
    }));
  }

  async launchApp(name: string): Promise<void> {
    await this.call('launch_app', { name });
  }

  async clickElement(pid: number, windowId: number, elementToken: string): Promise<void> {
    await this.call('click', { pid, window_id: windowId, element_token: elementToken, session: this.session });
  }

  async typeText(pid: number, windowId: number, elementToken: string, text: string): Promise<void> {
    await this.call('type_text', { pid, window_id: windowId, element_token: elementToken, text, session: this.session });
  }

  async pressKey(pid: number, windowId: number, key: string, modifiers: string[]): Promise<void> {
    await this.call('press_key', { pid, window_id: windowId, key, modifiers, session: this.session });
  }
}
