/**
 * The voice agent: an ElevenLabs Agents conversation over a raw WebSocket (no SDK), the same way
 * Juka's meet bot talks to its agent. The microphone goes up as 16 kHz PCM, the agent's voice comes
 * back as 16 kHz PCM and is played in order, and when the agent decides to act it calls one of the
 * worms' client tools (tools.ts): the call runs in the game and its answer goes back to the agent,
 * which says what happened in its own words ("¡Raúl calcula... ángulo 37, al 82%... KAMEHAMEHA!").
 *
 * The socket URL comes from GET /api/voice/session: a signed URL for a private agent (the API key
 * stays on the server), or the id of a public one. ?agent=<id> in the page URL opens a public agent
 * directly. The agent is created with the tools by tools/voice/create-agent.ts.
 */

import { runTool, type GameApi } from './tools.ts';

export type AgentStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error' | 'closed';

export interface AgentCallbacks {
  status(status: AgentStatus, detail?: string): void;
  /** What the player said, as the agent heard it. */
  heard(text: string): void;
  /** What the agent answered. */
  said(text: string): void;
  /** A tool ran: its name and answer, for the transcript. */
  acted(tool: string, ok: boolean, text: string): void;
}

/** Messages the agent sends that we act on; unknown ones are ignored, never fatal. */
export type ServerMessage =
  | { readonly kind: 'init'; readonly conversationId: string | null }
  | { readonly kind: 'audio'; readonly base64: string }
  | { readonly kind: 'user_transcript'; readonly text: string }
  | { readonly kind: 'agent_response'; readonly text: string }
  | { readonly kind: 'interruption' }
  | { readonly kind: 'ping'; readonly eventId: number }
  | { readonly kind: 'tool_call'; readonly name: string; readonly callId: string; readonly params: Record<string, unknown> }
  | { readonly kind: 'unknown'; readonly type: string };

export function parseServerMessage(data: string): ServerMessage {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return { kind: 'unknown', type: 'invalid_json' };
  }
  const sub = (key: string): Record<string, unknown> => {
    const value = msg[key];
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  };
  switch (msg['type']) {
    case 'conversation_initiation_metadata': {
      const id = sub('conversation_initiation_metadata_event')['conversation_id'];
      return { kind: 'init', conversationId: typeof id === 'string' ? id : null };
    }
    case 'audio':
      return { kind: 'audio', base64: String(sub('audio_event')['audio_base_64'] ?? '') };
    case 'user_transcript':
      return { kind: 'user_transcript', text: String(sub('user_transcription_event')['user_transcript'] ?? '') };
    case 'agent_response':
      return { kind: 'agent_response', text: String(sub('agent_response_event')['agent_response'] ?? '') };
    case 'interruption':
      return { kind: 'interruption' };
    case 'ping':
      return { kind: 'ping', eventId: Number(sub('ping_event')['event_id'] ?? 0) };
    case 'client_tool_call': {
      const call = sub('client_tool_call');
      const params = call['parameters'];
      return {
        kind: 'tool_call',
        name: String(call['tool_name'] ?? ''),
        callId: String(call['tool_call_id'] ?? ''),
        params: typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {},
      };
    }
    default:
      return { kind: 'unknown', type: String(msg['type'] ?? 'no_type') };
  }
}

/** The answer to a tool call, as the agent expects it. */
export function toolResult(callId: string, ok: boolean, text: string): string {
  return JSON.stringify({ type: 'client_tool_result', tool_call_id: callId, result: text, is_error: !ok });
}

/** Float samples at any rate to 16 kHz little endian PCM16, base64. */
export function encodePcm16(samples: Float32Array, fromRate: number, toRate = 16000): string {
  const ratio = fromRate / toRate;
  const length = Math.max(0, Math.floor(samples.length / ratio));
  const bytes = new Uint8Array(length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[Math.floor(i * ratio)] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

/** Base64 PCM16 back to floats, for playback. */
export function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const out = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

const SESSION_URL = '/api/voice/session';
const PUBLIC_SOCKET = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=';
/** Mic samples gathered before a chunk goes up: 100 ms at 16 kHz. */
const CHUNK_SAMPLES_16K = 1600;

/** Where to open the agent: ?agent= in the page URL, else the session route. Null when there is no agent. */
export async function resolveSocketUrl(search: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const fromUrl = new URLSearchParams(search).get('agent');
  if (fromUrl !== null && /^[A-Za-z0-9_-]{6,80}$/.test(fromUrl)) return PUBLIC_SOCKET + encodeURIComponent(fromUrl);
  try {
    const res = await fetchImpl(SESSION_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { signedUrl?: unknown; agentId?: unknown };
    if (typeof body.signedUrl === 'string' && body.signedUrl.startsWith('wss://')) return body.signedUrl;
    if (typeof body.agentId === 'string' && body.agentId !== '') return PUBLIC_SOCKET + encodeURIComponent(body.agentId);
  } catch {
    // No backend (a static preview): the local ear takes over.
  }
  return null;
}

export interface VoiceAgent {
  stop(): void;
  /** A note for the agent about the game it did not ask for (whose turn it is now); it does not answer it. */
  context(text: string): void;
}

/** Opens the conversation with the microphone; resolves once it is connecting, or rejects. */
export async function startVoiceAgent(url: string, api: GameApi, callbacks: AgentCallbacks): Promise<VoiceAgent> {
  callbacks.status('connecting');
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const audio = new AudioContext();
  await audio.audioWorklet.addModule('/voice/pcm-capture.js');
  const source = audio.createMediaStreamSource(mic);
  const capture = new AudioWorkletNode(audio, 'pcm-capture');
  source.connect(capture);
  const ws = new WebSocket(url);
  let ready = false;
  let closed = false;
  let pending: Float32Array[] = [];
  let pendingLength = 0;
  const chunkSamples = Math.round((CHUNK_SAMPLES_16K * audio.sampleRate) / 16000);

  // The agent's voice, played back to back; an interruption drops what is queued.
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const play = (base64: string): void => {
    const samples = decodePcm16(base64);
    if (samples.length === 0) return;
    const buffer = audio.createBuffer(1, samples.length, 16000);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    const at = Math.max(audio.currentTime + 0.02, playAt);
    node.start(at);
    playAt = at + buffer.duration;
    playing.add(node);
    callbacks.status('speaking');
    node.onended = () => {
      playing.delete(node);
      if (playing.size === 0 && !closed) callbacks.status('listening');
    };
  };
  const hush = (): void => {
    for (const node of playing) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    playing.clear();
    playAt = 0;
  };

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (!ready || ws.readyState !== WebSocket.OPEN) return;
    pending.push(event.data);
    pendingLength += event.data.length;
    if (pendingLength < chunkSamples) return;
    const joined = new Float32Array(pendingLength);
    let offset = 0;
    for (const part of pending) {
      joined.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingLength = 0;
    ws.send(JSON.stringify({ user_audio_chunk: encodePcm16(joined, audio.sampleRate) }));
  };

  const shutdown = (status: AgentStatus, detail?: string): void => {
    if (closed) return;
    closed = true;
    ready = false;
    hush();
    for (const track of mic.getTracks()) track.stop();
    capture.port.onmessage = null;
    source.disconnect();
    void audio.close().catch(() => undefined);
    if (ws.readyState <= WebSocket.OPEN) ws.close();
    callbacks.status(status, detail);
  };

  ws.onopen = () => ws.send(JSON.stringify({ type: 'conversation_initiation_client_data' }));
  ws.onerror = () => shutdown('error', 'The voice agent connection failed.');
  ws.onclose = () => shutdown('closed');
  ws.onmessage = (event: MessageEvent<string>) => {
    const msg = parseServerMessage(String(event.data));
    switch (msg.kind) {
      case 'init':
        ready = true;
        callbacks.status('listening');
        return;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', event_id: msg.eventId }));
        return;
      case 'audio':
        if (msg.base64 !== '') play(msg.base64);
        return;
      case 'interruption':
        hush();
        return;
      case 'user_transcript':
        if (msg.text !== '') callbacks.heard(msg.text);
        return;
      case 'agent_response':
        if (msg.text !== '') callbacks.said(msg.text);
        return;
      case 'tool_call': {
        const result = runTool(api, msg.name, msg.params);
        callbacks.acted(msg.name, result.ok, result.text);
        if (ws.readyState === WebSocket.OPEN) ws.send(toolResult(msg.callId, result.ok, result.text));
        return;
      }
      default:
        return;
    }
  };

  return {
    stop: () => shutdown('idle'),
    context: (text: string) => {
      if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'contextual_update', text }));
    },
  };
}
