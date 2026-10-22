import type { CookieOptions } from '@supabase/ssr';

const REMEMBER_SESSION_KEY = 'gfacilerp.rememberSession';

export function readRememberSessionPreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(REMEMBER_SESSION_KEY) === 'true';
}

export function saveRememberSessionPreference(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'>,
): void {
  storage.setItem(REMEMBER_SESSION_KEY, String(enabled));
}

export function getAuthCookieOptions(
  options: CookieOptions,
  rememberSession: boolean,
): CookieOptions {
  if (rememberSession || options.maxAge === 0) return options;

  const sessionOptions = { ...options };
  delete sessionOptions.maxAge;
  delete sessionOptions.expires;
  return sessionOptions;
}

export function serializeAuthCookie(
  name: string,
  value: string,
  options: CookieOptions,
  secureContext: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.sameSite === true) {
    parts.push('SameSite=Strict');
  } else if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure || secureContext) parts.push('Secure');

  return parts.join('; ');
}
