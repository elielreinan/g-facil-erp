import { describe, expect, it } from 'vitest';
import {
  getAuthCookieOptions,
  readRememberSessionPreference,
  saveRememberSessionPreference,
  serializeAuthCookie,
} from '../lib/auth-session-preference';

describe('remember session preference', () => {
  it('is disabled unless the user explicitly enabled it', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readRememberSessionPreference(storage)).toBe(false);
    saveRememberSessionPreference(true, storage);
    expect(readRememberSessionPreference(storage)).toBe(true);
    saveRememberSessionPreference(false, storage);
    expect(readRememberSessionPreference(storage)).toBe(false);
  });

  it('removes persistent expiry options for a session-only login', () => {
    const expires = new Date('2030-01-01T00:00:00.000Z');

    expect(getAuthCookieOptions({ maxAge: 400, expires, path: '/' }, false)).toEqual({
      path: '/',
    });
    expect(getAuthCookieOptions({ maxAge: 400, expires, path: '/' }, true)).toEqual({
      maxAge: 400,
      expires,
      path: '/',
    });
  });

  it('preserves cookie deletion options when remember me is disabled', () => {
    expect(getAuthCookieOptions({ maxAge: 0, path: '/' }, false)).toEqual({
      maxAge: 0,
      path: '/',
    });
  });

  it('serializes session and persistent cookies with secure attributes', () => {
    expect(serializeAuthCookie('auth-token', 'abc', { path: '/', sameSite: 'lax' }, true))
      .toBe('auth-token=abc; Path=/; SameSite=lax; Secure');
    expect(serializeAuthCookie('auth-token', 'abc', { path: '/', maxAge: 400 }, false))
      .toBe('auth-token=abc; Max-Age=400; Path=/');
  });
});
