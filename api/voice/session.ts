/**
 * Vercel function for GET /api/voice/session: the signed WebSocket URL of the private ElevenLabs
 * voice agent that commands the worms (src/voice/elevenlabs.ts), minted with ELEVENLABS_API_KEY so
 * the key never reaches the page, or the agent id alone when no key is set (a public agent).
 * Mirrors sidecar/voice-session.ts, which serves the same route in `npm run dev`.
 */

const API = 'https://api.elevenlabs.io/v1';

function reply(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function GET(): Promise<Response> {
  const agentId = (process.env['ELEVENLABS_AGENT_ID'] ?? '').trim();
  const apiKey = (process.env['ELEVENLABS_API_KEY'] ?? '').trim();
  if (agentId === '') return reply(503, { error: 'no voice agent configured (ELEVENLABS_AGENT_ID)' });
  if (apiKey === '') return reply(200, { agentId });
  try {
    const res = await fetch(`${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) return reply(502, { error: `get-signed-url failed with HTTP ${res.status}` });
    const json = (await res.json()) as { signed_url?: unknown };
    if (typeof json.signed_url !== 'string' || !json.signed_url.startsWith('wss://')) return reply(502, { error: 'get-signed-url returned no signed_url' });
    return reply(200, { signedUrl: json.signed_url });
  } catch {
    return reply(502, { error: 'could not reach ElevenLabs' });
  }
}
