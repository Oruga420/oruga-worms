import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { main } from '../../../../tools/assets/generate.ts';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
const ARGS = ['--execute', '--budget-usd', '0.384', '--reference-root', 'C:/fixtures/references'];
const JPEG = Buffer.from([0xff, 0xd8, 0, 0]);
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', network);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(readFile).mockImplementation(async (path) => String(path).endsWith('.env') ? 'REPLICATE_API_TOKEN=unit-test-token' : JPEG);
  network.mockImplementation(async (url) => {
    if (String(url).includes('api.replicate.com')) {
      return new Response(JSON.stringify({ id: 'prediction-test', status: 'succeeded', output: ['https://replicate.delivery/test.png'] }), { status: 200 });
    }
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('image helper spending boundaries, with mocked network and filesystem', () => {
  it('defaults to dry-run without reading secrets, references or sending requests', async () => {
    await main([]);
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects missing budgets/references before loading any credential', async () => {
    await expect(main(['--execute'])).rejects.toThrow(/budget/);
    await expect(main(['--execute', '--budget-usd', '0.384'])).rejects.toThrow(/reference-root/);
    expect(readFile).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects broken reference inputs before reading the personal token', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('not a jpeg'));
    await expect(main(ARGS)).rejects.toThrow(/JPEG/);
    expect(vi.mocked(readFile).mock.calls.some(([path]) => String(path).endsWith('.env'))).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it('refuses an existing batch receipt before any paid request', async () => {
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('EEXIST'));
    await expect(main(ARGS)).rejects.toThrow('EEXIST');
    expect(network).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile).mock.calls[0]?.[2]).toEqual({ flag: 'wx' });
  });

  it('submits exactly three single-image predictions, attaches Kame data and never sends credentials to delivery', async () => {
    await main(ARGS);
    const calls = network.mock.calls;
    const predictions = calls.filter(([, options]) => options?.method === 'POST');
    expect(predictions).toHaveLength(3);
    const inputs = predictions.map(([, options]) => JSON.parse(String(options?.body)).input);
    expect(inputs.map((input) => input.number_of_images)).toEqual([1, 1, 1]);
    expect(inputs[2].input_images).toHaveLength(2);
    for (const [url, options] of calls.filter(([url]) => String(url).includes('replicate.delivery'))) {
      expect(String(url)).toContain('replicate.delivery');
      expect(options?.headers).toBeUndefined();
    }
    expect(JSON.stringify(vi.mocked(writeFile).mock.calls)).not.toContain('unit-test-token');
    expect(JSON.stringify(vi.mocked(writeFile).mock.calls)).not.toContain('data:image');
    const env = vi.mocked(readFile).mock.calls.find(([path]) => String(path).endsWith('.env'));
    expect(String(env?.[0]).replaceAll('\\', '/')).toContain('/.claude/skills/oruga-blender/.env');
  });

  it('does not retry a rejected prediction or proceed to later images', async () => {
    network.mockResolvedValueOnce(new Response('private provider error', { status: 500 }));
    await expect(main(ARGS)).rejects.toThrow('HTTP 500');
    expect(network).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a malicious delivery URL without calling it', async () => {
    network.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'prediction-test', status: 'succeeded', output: 'https://evil.test/asset.png' })));
    await expect(main(ARGS)).rejects.toThrow(/host/);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed prediction responses without retrying', async () => {
    network.mockResolvedValueOnce(new Response(JSON.stringify({ id: '../../other', status: 'succeeded' })));
    await expect(main(ARGS)).rejects.toThrow(/Unexpected prediction/);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
