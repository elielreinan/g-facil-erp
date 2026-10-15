import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Configure as variáveis públicas do Supabase do GFacilERP.');
  }

  return createBrowserClient(url, anonKey);
}
