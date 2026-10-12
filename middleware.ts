/**
 * Vercel Routing Middleware: a password in front of the whole site when SITE_PASSWORD is set in the
 * project's environment (the private preview deployment of the voice version). Without it, as on the
 * public game, every request goes straight through. HTTP Basic auth: any user name, that password.
 */

export const config = { matcher: '/:path*' };

const REALM = 'Orugas preview';

/** Compares without bailing out at the first difference, so the time taken says nothing about the password. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default function middleware(request: Request): Response | undefined {
  const password = process.env['SITE_PASSWORD'] ?? '';
  if (password === '') return undefined;
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1);
      if (same(given, password)) return undefined;
    } catch {
      // A malformed header is a wrong password.
    }
  }
  return new Response('Password required', { status: 401, headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' } });
}
