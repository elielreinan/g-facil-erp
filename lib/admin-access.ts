import { getSupabaseClient } from './supabase';

export async function requireAdmin() {
  const supabase = getSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!authData.user) {
    return { supabase, user: null, authorized: false, mfaRequired: false };
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

  if (!administrator) {
    return {
      supabase,
      user: authData.user,
      authorized: false,
      mfaRequired: false,
    };
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  const mfaRequired = assurance.currentLevel !== 'aal2';

  return {
    supabase,
    user: authData.user,
    authorized: !mfaRequired,
    mfaRequired,
  };
}
