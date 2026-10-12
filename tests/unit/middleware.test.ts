import { afterEach, describe, expect, it } from 'vitest';
import middleware from '../../middleware.ts';

const ask = (auth?: string): Response | undefined => middleware(new Request('https://x.test/', auth === undefined ? {} : { headers: { authorization: auth } }));
const basic = (user: string, pass: string): string => `Basic ${btoa(`${user}:${pass}`)}`;

describe('password middleware', () => {
  afterEach(() => {
    delete process.env['SITE_PASSWORD'];
  });

  it('lets everything through when no password is set (the public game)', () => {
    expect(ask()).toBeUndefined();
  });

  it('asks for the password, and takes it with any user name', () => {
    process.env['SITE_PASSWORD'] = 'A1s2d3f4@';
    expect(ask()?.status).toBe(401);
    expect(ask()?.headers.get('WWW-Authenticate')).toContain('Basic');
    expect(ask(basic('x', 'wrong'))?.status).toBe(401);
    expect(ask('Basic !!!')?.status).toBe(401);
    expect(ask(basic('anyone', 'A1s2d3f4@'))).toBeUndefined();
  });
});
