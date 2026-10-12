/**
 * The voice agent's session (src/voice/elevenlabs.ts): the browser asks GET /api/voice/session and
 * gets either a signed WebSocket URL for the private ElevenLabs agent, minted here with the API key
 * (the key never reaches the page), or the agent id alone when the agent is public. The signed URL
 * is handed over exactly as ElevenLabs returned it and is good for 15 minutes.
 *
 * Same logic as the Vercel function in api/voice/session.ts, which cannot import from here.
 */

export interface VoiceSessionConfig {
  readonly apiKey?: string;
  readonly agentId?: string;
}

export type VoiceSessionBody = { readonly signedUrl: string } | { readonly agentId: string } | { readonly error: string };

export interface VoiceSessionResponse {
  readonly status: number;
  readonly body: VoiceSessionBody;
}

const API = 'https://api.elevenlabs.io/v1';

export async function voiceSession(config: VoiceSessionConfig | undefined, fetchImpl: typeof fetch = fetch): Promise<VoiceSessionResponse> {
  const agentId = config?.agentId;
  if (agentId === undefined || agentId === '') return { status: 503, body: { error: 'no voice agent configured (ELEVENLABS_AGENT_ID)' } };
  // No key: the agent must be public, and the browser opens it by id.
  if (config?.apiKey === undefined || config.apiKey === '') return { status: 200, body: { agentId } };
  try {
    const res = await fetchImpl(`${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { 'xi-api-key': config.apiKey } });
    if (!res.ok) return { status: 502, body: { error: `get-signed-url failed with HTTP ${res.status}` } };
    const json = (await res.json()) as { signed_url?: unknown };
    if (typeof json.signed_url !== 'string' || !json.signed_url.startsWith('wss://')) return { status: 502, body: { error: 'get-signed-url returned no signed_url' } };
    return { status: 200, body: { signedUrl: json.signed_url } };
  } catch {
    return { status: 502, body: { error: 'could not reach ElevenLabs' } };
  }
}
