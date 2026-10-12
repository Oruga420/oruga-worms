import { describe, expect, it } from 'vitest';
import { decodePcm16, encodePcm16, parseServerMessage, resolveSocketUrl, toolResult } from '../../../src/voice/elevenlabs.ts';
import { clientTools } from '../../../tools/voice/agent.ts';
import { TOOLS } from '../../../src/voice/tools.ts';

describe('ElevenLabs agent messages', () => {
  it('reads a client tool call and answers it', () => {
    const msg = parseServerMessage(JSON.stringify({ type: 'client_tool_call', client_tool_call: { tool_name: 'walk', tool_call_id: 'c1', parameters: { direction: 'left', steps: 5 } } }));
    expect(msg).toEqual({ kind: 'tool_call', name: 'walk', callId: 'c1', params: { direction: 'left', steps: 5 } });
    expect(JSON.parse(toolResult('c1', true, 'done'))).toEqual({ type: 'client_tool_result', tool_call_id: 'c1', result: 'done', is_error: false });
  });

  it('never throws on junk', () => {
    expect(parseServerMessage('not json').kind).toBe('unknown');
    expect(parseServerMessage('{"type":"ping","ping_event":{"event_id":4}}')).toEqual({ kind: 'ping', eventId: 4 });
  });

  it('round trips 16 kHz PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const back = decodePcm16(encodePcm16(samples, 16000));
    expect(Array.from(back).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, -0.5, 0.25]);
    // 48 kHz in, a third of the samples out.
    expect(decodePcm16(encodePcm16(new Float32Array(48), 48000))).toHaveLength(16);
  });

  it('opens a public agent from ?agent= and the session route otherwise', async () => {
    expect(await resolveSocketUrl('?agent=agent_abc123')).toBe('wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_abc123');
    const fetchImpl = (async () => new Response(JSON.stringify({ signedUrl: 'wss://x/y' }), { status: 200 })) as typeof fetch;
    expect(await resolveSocketUrl('', fetchImpl)).toBe('wss://x/y');
    const down = (async () => new Response('{}', { status: 503 })) as typeof fetch;
    expect(await resolveSocketUrl('', down)).toBeNull();
  });

  it('creates the agent with every tool the page answers', () => {
    expect(clientTools().map((t) => t['name'])).toEqual(TOOLS.map((t) => t.name));
  });
});
