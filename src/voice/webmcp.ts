/**
 * WebMCP: the worms' tools (tools.ts) registered on navigator.modelContext, so an agent in the
 * browser (Chrome's WebMCP, or the MCP-B extension and its polyfill) can look at the battle and
 * command the worm whose turn it is, the same way the voice agent does. Feature detected: in a
 * browser without WebMCP this does nothing. Registered once at boot; the tools read the live game.
 */

import { TOOLS, inputSchema, runTool, type GameApi } from './tools.ts';

interface WebMcpContent {
  readonly type: 'text';
  readonly text: string;
}

interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: { readonly readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<{ content: WebMcpContent[]; isError?: boolean }>;
}

interface ModelContext {
  registerTool?(tool: WebMcpTool): { unregister?: () => void } | undefined | void;
  unregisterTool?(name: string): void;
  provideContext?(context: { tools: WebMcpTool[] }): void;
}

function modelContext(): ModelContext | null {
  const nav = navigator as Navigator & { modelContext?: ModelContext };
  return nav.modelContext ?? null;
}

export function webMcpTools(api: GameApi): WebMcpTool[] {
  return TOOLS.map((def) => ({
    name: `orugas_${def.name}`,
    description: `Orugas worms game: ${def.description}`,
    inputSchema: inputSchema(def),
    ...(def.name === 'get_battle_state' ? { annotations: { readOnlyHint: true } } : {}),
    execute: async (input: Record<string, unknown>) => {
      const result = runTool(api, def.name, input ?? {});
      return { content: [{ type: 'text', text: result.text }], ...(result.ok ? {} : { isError: true }) };
    },
  }));
}

/** Registers the tools when the browser offers WebMCP; true when it did. */
export function registerWebMcp(api: GameApi): boolean {
  const context = modelContext();
  if (context === null) return false;
  const tools = webMcpTools(api);
  try {
    if (typeof context.registerTool === 'function') {
      for (const tool of tools) context.registerTool(tool);
      return true;
    }
    if (typeof context.provideContext === 'function') {
      context.provideContext({ tools });
      return true;
    }
  } catch {
    // An agent that refuses the tools leaves the game as it was.
  }
  return false;
}
