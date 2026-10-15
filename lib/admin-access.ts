import { getSupabaseClient } from './supabase';

export async function requireAdmin() {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { supabase, user: null, authorized: false };
  }

  const { data: administrator, error: administratorError } = await supabase
    .from('administradores')
    .select('id')
    .eq('id', authData.user.id)
    .eq('ativo', true)
    .maybeSingle();

  if (administratorError) {
    throw administratorError;
  }

  return { supabase, user: authData.user, authorized: Boolean(administrator) };
}
