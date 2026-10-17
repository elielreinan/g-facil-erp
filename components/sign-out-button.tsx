'use client';

import { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';

export function SignOutButton({ global = false }: { global?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (busy) return;
    if (global && !window.confirm('Encerrar todas as sessões administrativas, incluindo outros dispositivos?')) return;

    setBusy(true);
    setError('');
    try {
      const { error: signOutError } = await getSupabaseClient().auth.signOut({
        scope: global ? 'global' : 'local',
      });
      if (signOutError) throw signOutError;
      window.location.replace('/login');
    } catch (caughtError) {
      console.error('Falha ao encerrar sessão administrativa:', caughtError);
      setError('Não foi possível encerrar a sessão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void signOut()}
        type="button"
      >
        {busy ? 'Saindo...' : global ? 'Encerrar todas as sessões' : 'Sair'}
      </button>
      {error && <span className="alert error" role="alert">{error}</span>}
    </span>
  );
}
