/**
 * Creates (or updates) the ElevenLabs voice agent that commands the worms, with the game's client
 * tools (tools/voice/agent.ts), and prints its id for ELEVENLABS_AGENT_ID. Never prints the key.
 *
 *   ELEVENLABS_API_KEY=... node tools/voice/create-agent.ts              create a new agent
 *   ELEVENLABS_API_KEY=... ELEVENLABS_AGENT_ID=... node tools/voice/create-agent.ts --update
 *                                                                         push the persona and tools to it
 *
 * The key is read from the environment or the project .env (like the sound pipeline). Then set
 * ELEVENLABS_AGENT_ID (and ELEVENLABS_API_KEY for a private agent) in sidecar/.env for `npm run dev`,
 * and in the Vercel project's environment for the deployed game (api/voice/session.ts).
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, mergeEnv } from '../../sidecar/env.ts';
import { agentBody } from './agent.ts';

const API = 'https://api.elevenlabs.io/v1';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const env = mergeEnv(loadDotEnv(resolve(ROOT, '.env')), loadDotEnv(resolve(ROOT, 'sidecar', '.env')), process.env);
const key = (env['ELEVENLABS_API_KEY'] ?? '').trim();
const agentId = (env['ELEVENLABS_AGENT_ID'] ?? '').trim();
const update = process.argv.includes('--update');

if (key === '') {
  console.error('create-agent: ELEVENLABS_API_KEY is not set (environment, .env or sidecar/.env).');
  process.exit(1);
}
if (update && agentId === '') {
  console.error('create-agent: --update needs ELEVENLABS_AGENT_ID.');
  process.exit(1);
}

const url = update ? `${API}/convai/agents/${encodeURIComponent(agentId)}` : `${API}/convai/agents/create`;
const res = await fetch(url, {
  method: update ? 'PATCH' : 'POST',
  headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify(agentBody()),
});
const text = await res.text();
if (!res.ok) {
  console.error(`create-agent: HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
const body = JSON.parse(text) as { agent_id?: string };
const id = body.agent_id ?? agentId;
console.log(update ? `Updated agent ${id}.` : `Created agent ${id}.`);
console.log(`Set ELEVENLABS_AGENT_ID=${id} in sidecar/.env (dev) and in the Vercel environment (prod).`);
