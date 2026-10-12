import { describe, expect, it } from 'vitest';
import { handleApiRoute } from '../../../sidecar/handler.ts';
import { voiceSession } from '../../../sidecar/voice-session.ts';

const signed = (url: string): typeof fetch => (async () => new Response(JSON.stringify({ signed_url: url }), { status: 200 })) as typeof fetch;

describe('voice session route', () => {
  it('answers 503 with no agent configured', async () => {
    const response = await handleApiRoute({ method: 'GET', path: '/voice/session' });
    expect(response.status).toBe(503);
  });

  it('hands out the agent id of a public agent when there is no key', async () => {
    expect(await voiceSession({ agentId: 'agent_123' })).toEqual({ status: 200, body: { agentId: 'agent_123' } });
  });

  it('mints a signed URL with the key, which never reaches the answer', async () => {
    let sentKey = '';
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentKey = new Headers(init?.headers).get('xi-api-key') ?? '';
      return new Response(JSON.stringify({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?token=x' }), { status: 200 });
    }) as typeof fetch;
    const response = await handleApiRoute({ method: 'GET', path: '/voice/session' }, { backend: 'off', voice: { agentId: 'a1', apiKey: 'secret' }, fetchImpl });
    expect(response.status).toBe(200);
    expect(sentKey).toBe('secret');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('refuses anything that is not a wss URL', async () => {
    expect((await voiceSession({ agentId: 'a1', apiKey: 'k' }, signed('http://evil'))).status).toBe(502);
  });

  it('only answers GET', async () => {
    expect((await handleApiRoute({ method: 'POST', path: '/voice/session' })).status).toBe(405);
  });
});
