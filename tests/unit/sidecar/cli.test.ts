import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { CPU_TURN_SCHEMA, type CpuTurnRequest } from '../../../src/ai/contract.ts';
import type { WeaponId } from '../../../src/weapons/types.ts';
import {
  buildCliArgs,
  cliEntryCandidates,
  parseCliEnvelope,
  requestCpuTurnViaCli,
  resolveCliEntry,
  type SpawnFn,
} from '../../../sidecar/backends/cli.ts';

function fixture(): CpuTurnRequest {
  return {
    schema: CPU_TURN_SCHEMA,
    matchId: 'm1',
    turn: 1,
    difficulty: 'easy',
    personality: 'chaotic',
    windStep: 0,
    wind: 0,
    gravity: 900,
    waterY: 640,
    world: { w: 1920, h: 696 },
    active: { wormId: 'a', team: 'A', x: 10, y: 20, hp: 100, canMoveLeft: true, canMoveRight: true, maxWalkMs: 3000 },
    allies: [],
    enemies: [{ id: 'e', team: 'B', x: 500, y: 20, hp: 100 }],
    ammo: [{ weapon: 'bazooka' as WeaponId, count: -1 }],
    terrain: { profile: [1, 2, 3], sampleStepPx: 30 },
    lineOfSight: [],
  };
}

interface FakeChild {
  readonly child: ChildProcess;
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly emitter: EventEmitter;
  readonly kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const kill = vi.fn();
  const child = Object.assign(emitter, { stdin, stdout, stderr: new PassThrough(), kill }) as unknown as ChildProcess;
  return { child, stdin, stdout, emitter, kill };
}

describe('buildCliArgs', () => {
  it('uses the verified isolation set, never --bare, with --allowedTools last and empty', () => {
    const args = buildCliArgs('claude-haiku-4-5-20251001', 'SYS');
    expect(args).not.toContain('--bare');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--setting-sources=');
    expect(args).toContain('--tools=');
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--no-session-persistence');
    expect(args.slice(-2)).toEqual(['--allowedTools', '']);
    expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('SYS');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5-20251001');
  });
});

describe('cli entry resolution', () => {
  it('prefers the env override, then the APPDATA npm root', () => {
    const candidates = cliEntryCandidates({ ORUGAS_CLAUDE_CLI: 'C:/x/cli.js', APPDATA: 'C:/Users/u/AppData/Roaming' });
    expect(candidates[0]).toBe('C:/x/cli.js');
    expect(candidates[1]).toMatch(/npm[\\/]node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/);
  });

  it('returns the first existing candidate or an error', () => {
    const env = { APPDATA: 'C:/a' };
    const found = resolveCliEntry(env, (p) => p.includes('claude-code'));
    expect(found.ok).toBe(true);
    const missing = resolveCliEntry(env, () => false);
    expect(missing.ok).toBe(false);
  });
});

describe('parseCliEnvelope', () => {
  it('extracts result, cost and duration', () => {
    const result = parseCliEnvelope('{"type":"result","is_error":false,"result":"{\\"a\\":1}","total_cost_usd":0.01,"duration_ms":1200}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ result: '{"a":1}', costUsd: 0.01, durationMs: 1200 });
  });

  it('treats is_error as a failure even when subtype says success', () => {
    const result = parseCliEnvelope('{"subtype":"success","is_error":true,"result":"Not logged in"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Not logged in');
  });

  it('rejects envelopes without a text result', () => {
    expect(parseCliEnvelope('{"is_error":false}').ok).toBe(false);
    expect(parseCliEnvelope('garbage').ok).toBe(false);
  });
});

describe('requestCpuTurnViaCli', () => {
  it('spawns node with the entry file, feeds the prompt on stdin and returns the raw decision', async () => {
    const fake = fakeChild();
    let spawnedCommand = '';
    let spawnedArgs: readonly string[] = [];
    let received = '';
    fake.stdin.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
    });
    const spawn: SpawnFn = (command, args) => {
      spawnedCommand = command;
      spawnedArgs = args;
      return fake.child;
    };
    const pending = requestCpuTurnViaCli(fixture(), { cliEntry: 'C:/fake/cli.js', spawn, timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 5));
    fake.stdout.write('{"is_error":false,"result":"```json\\n{\\"weapon\\":\\"bazooka\\",\\"power\\":70}\\n```","total_cost_usd":0.02,"duration_ms":900}');
    fake.emitter.emit('close', 0);
    const result = await pending;
    expect(spawnedCommand).toBe(process.execPath);
    expect(spawnedArgs[0]).toBe('C:/fake/cli.js');
    expect(received).toContain('GAME_STATE_JSON');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.raw).toEqual({ weapon: 'bazooka', power: 70 });
      expect(result.value.costUsd).toBe(0.02);
    }
  });

  it('kills the child and fails on timeout', async () => {
    const fake = fakeChild();
    const spawn: SpawnFn = () => fake.child;
    const result = await requestCpuTurnViaCli(fixture(), { cliEntry: 'C:/fake/cli.js', spawn, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('timed out');
    expect(fake.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reports a cli error envelope as a failure', async () => {
    const fake = fakeChild();
    const spawn: SpawnFn = () => fake.child;
    const pending = requestCpuTurnViaCli(fixture(), { cliEntry: 'C:/fake/cli.js', spawn });
    await new Promise((r) => setTimeout(r, 5));
    fake.stdout.write('{"is_error":true,"result":"Not logged in"}');
    fake.emitter.emit('close', 1);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('code 1');
  });
});
