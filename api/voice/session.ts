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

/**
 * Only the game's own page may ask: a browser on another site sends Sec-Fetch-Site cross-site (or
 * an Origin that is not ours), and gets nothing to open the paid agent with.
 */
function fromOurPage(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!fromOurPage(request)) return reply(403, { error: 'forbidden' });
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
