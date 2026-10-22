import { createBrowserClient, type SetAllCookies } from '@supabase/ssr';
import {
  getAuthCookieOptions,
  readRememberSessionPreference,
  serializeAuthCookie,
} from './auth-session-preference';

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Configure as variáveis públicas do Supabase do GFacilERP.');
  }

  return createBrowserClient(url, anonKey, {
    cookies: {
      getAll() {
        if (typeof document === 'undefined') {
          throw new Error('A sessão do Supabase só pode ser lida no navegador.');
        }

        return document.cookie.split(';').filter(Boolean).map((cookie) => {
          const separator = cookie.indexOf('=');
          const name = cookie.slice(0, separator).trim();
          const value = cookie.slice(separator + 1).trim();
          return { name, value: decodeURIComponent(value) };
        });
      },
      setAll(cookies: Parameters<SetAllCookies>[0]) {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
          throw new Error('A sessão do Supabase só pode ser atualizada no navegador.');
        }

        const rememberSession = readRememberSessionPreference(window.localStorage);
        cookies.forEach(({ name, value, options }) => {
          const cookieOptions = getAuthCookieOptions(options, rememberSession);
          document.cookie = serializeAuthCookie(
            name,
            value,
            cookieOptions,
            window.location.protocol === 'https:',
          );
        });
      },
    },
  });
}
