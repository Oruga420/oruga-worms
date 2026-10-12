/**
 * The local ear, for playing by voice with no agent at all: the browser's own speech recognition
 * (Chrome, Edge, Safari) hears the order, parse.ts turns it into the worms' tool calls, they run in
 * order, and the browser's speech synthesis says a short line back. Spanish (es-MX) by default,
 * ?voicelang=en-US for English. When ElevenLabs is configured the agent replaces all of this.
 */

import { parseUtterance } from './parse.ts';
import { runTool, type GameApi } from './tools.ts';
import type { AgentCallbacks, VoiceAgent } from './elevenlabs.ts';

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

export function speechRecognitionAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) !== undefined;
}

const CRIES: readonly string[] = Object.freeze([
  '¡Toma esto, {target}!',
  '¡Ya te vi, {target}! ¡{weapon}!',
  '¡Calculado al milímetro!',
  '¡Esto es por mis hermanos gusanos!',
  '¡Despídete, {target}!',
  '¡Con todo mi poder... {weapon}!',
  '¡No hay escapatoria, {target}!',
  '¡Ni lo vas a ver venir!',
]);

/** A battle cry for the local ear, which has no model to write one. */
export function battleCry(weapon: string, target: string | null, pick: number): string {
  const line = CRIES[Math.abs(Math.floor(pick)) % CRIES.length] ?? CRIES[0] ?? '';
  return line.replace('{target}', target ?? 'gusano').replace('{weapon}', weapon.toUpperCase());
}

const SAY_OK: Readonly<Record<string, string>> = Object.freeze({
  choose_worm: '¡Yo te elijo!',
  walk: '¡En marcha!',
  turn_around: 'Media vuelta.',
  jump: '¡Hop!',
  aim: 'Apuntando.',
  select_weapon: 'Arma lista.',
  fire: '¡Fuego!',
  ai_attack: 'Calculando...',
  skip_turn: 'Paso.',
  stop: 'Alto.',
});

/** Starts listening; the returned handle stops it. Throws when the browser has no recognition. */
export function startLocalEar(api: GameApi, callbacks: AgentCallbacks, lang: string): VoiceAgent {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (Ctor === undefined) throw new Error('no speech recognition in this browser');
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = false;
  let running = true;
  let cries = 0;

  const speak = (text: string): void => {
    if (typeof speechSynthesis === 'undefined' || text === '') return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result === undefined || !result.isFinal) continue;
      const text = result[0].transcript.trim();
      if (text === '') continue;
      callbacks.heard(text);
      const view = api.view();
      const calls = parseUtterance(text, view?.worms.map((w) => w.name) ?? []);
      if (calls.length === 0) {
        callbacks.said('No entendí la orden.');
        continue;
      }
      let reply = '';
      for (const call of calls) {
        const args: Record<string, unknown> = { ...call.args };
        if (call.tool === 'ai_attack' && args['battle_cry'] === undefined) {
          cries += 1;
          args['battle_cry'] = battleCry(String(args['weapon'] ?? view?.weaponInHand ?? ''), typeof args['target'] === 'string' ? args['target'] : null, cries + text.length);
        }
        const out = runTool(api, call.tool, args);
        callbacks.acted(call.tool, out.ok, out.text);
        if (!out.ok) {
          reply = `No se puede: ${out.text}`;
          break;
        }
        reply = SAY_OK[call.tool] ?? reply;
      }
      callbacks.said(reply);
      speak(reply);
    }
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      running = false;
      callbacks.status('error', 'The microphone was not allowed.');
    }
  };
  // Chrome ends a continuous session after a silence: start it again while it is on.
  recognition.onend = () => {
    if (!running) return;
    try {
      recognition.start();
    } catch {
      running = false;
      callbacks.status('closed');
    }
  };
  recognition.start();
  callbacks.status('listening');
  return {
    stop: () => {
      running = false;
      recognition.stop();
      callbacks.status('idle');
    },
    context: () => undefined,
  };
}
