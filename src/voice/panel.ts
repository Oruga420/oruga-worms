/**
 * The voice button and its transcript, over the stage: press it (or V) to talk to the worms. With
 * an ElevenLabs agent configured it opens the agent (elevenlabs.ts); without one, the browser's own
 * speech recognition (speech.ts). The last few lines heard, said and done float above the button.
 * WebMCP needs no button: the tools are registered at boot (webmcp.ts).
 */

import { resolveSocketUrl, startVoiceAgent, type AgentCallbacks, type AgentStatus, type VoiceAgent } from './elevenlabs.ts';
import { speechRecognitionAvailable, startLocalEar } from './speech.ts';
import type { GameApi } from './tools.ts';

const LINES = 5;
/** A line leaves the transcript after this long. */
const LINE_MS = 9000;
const LINE_CHARS = 110;

const LABEL: Readonly<Record<AgentStatus, string>> = Object.freeze({
  idle: '🎤 Voz',
  connecting: '… Conectando',
  listening: '🎙 Escuchando',
  speaking: '🔊 Hablando',
  error: '⚠ Voz',
  closed: '🎤 Voz',
});

export interface VoicePanel {
  /** Tells a running agent what changed in the game (whose turn it is now). */
  note(text: string): void;
  toggle(): void;
}

export function createVoicePanel(root: HTMLElement, api: GameApi): VoicePanel {
  const box = document.createElement('div');
  box.className = 'voice';
  const log = document.createElement('ol');
  log.className = 'voice-log';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'voice-btn';
  button.title = 'Talk to the worms (V)';
  button.textContent = LABEL.idle;
  box.append(log, button);
  root.append(box);

  let agent: VoiceAgent | null = null;
  let starting = false;

  const line = (kind: 'heard' | 'said' | 'acted' | 'error', text: string): void => {
    const item = document.createElement('li');
    item.className = `voice-${kind}`;
    // A long tool answer (the weapon list) would cover the screen: the transcript keeps its start.
    item.textContent = text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS - 1)}…` : text;
    item.title = text;
    log.append(item);
    window.setTimeout(() => item.remove(), LINE_MS);
    while (log.children.length > LINES) log.firstElementChild?.remove();
  };

  const callbacks: AgentCallbacks = {
    status: (status, detail) => {
      button.textContent = LABEL[status];
      button.dataset['state'] = status;
      if (detail !== undefined) line('error', detail);
      if (status === 'idle' || status === 'closed' || status === 'error') agent = null;
    },
    heard: (text) => line('heard', `🗣 ${text}`),
    said: (text) => line('said', `🐛 ${text}`),
    acted: (tool, ok, text) => line(ok ? 'acted' : 'error', `${ok ? '✔' : '✖'} ${tool}: ${text}`),
  };

  const start = async (): Promise<void> => {
    if (starting) return;
    starting = true;
    try {
      const url = await resolveSocketUrl(window.location.search);
      if (url !== null) {
        agent = await startVoiceAgent(url, api, callbacks);
      } else if (speechRecognitionAvailable()) {
        const lang = new URLSearchParams(window.location.search).get('voicelang') ?? 'es-MX';
        agent = startLocalEar(api, callbacks, /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : 'es-MX');
        line('said', 'Modo local: di "Rojo, yo te elijo, usa la bazuca".');
      } else {
        callbacks.status('error', 'This browser has no speech recognition and no voice agent is set up.');
      }
    } catch (error) {
      callbacks.status('error', error instanceof Error ? error.message : 'Voice failed to start.');
    } finally {
      starting = false;
    }
  };

  const toggle = (): void => {
    if (agent !== null) {
      agent.stop();
      agent = null;
      return;
    }
    void start();
  };
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggle();
  });

  return {
    note: (text) => agent?.context(text),
    toggle,
  };
}
