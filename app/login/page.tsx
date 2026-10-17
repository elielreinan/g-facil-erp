'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '../../lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError('Credenciais inválidas ou acesso administrativo não autorizado.');
        return;
      }
      const { data: authData, error: userError } = await supabase.auth.getUser();
      if (userError || !authData.user) {
        await supabase.auth.signOut();
        setError('Credenciais inválidas ou acesso administrativo não autorizado.');
        return;
      }
      const { data: administrator, error: administratorError } = await supabase
        .from('administradores')
        .select('id')
        .eq('id', authData.user.id)
        .eq('ativo', true)
        .maybeSingle();
      if (administratorError || !administrator) {
        await supabase.auth.signOut();
        setError('Credenciais inválidas ou acesso administrativo não autorizado.');
        return;
      }
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      router.replace(assurance.currentLevel === 'aal2' ? '/usuarios' : '/mfa');
    } catch (caughtError) {
      console.error('Falha no login administrativo:', caughtError);
      setError('Não foi possível iniciar a sessão.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-page"><section className="card login-card"><p className="brand">GFACILERP</p><h1>Gestão administrativa</h1><p>Controle seguro das contas do FacilERP.</p><form onSubmit={submit}><div className="field"><label htmlFor="email">E-mail</label><input autoComplete="username" id="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></div><div className="field"><label htmlFor="password">Senha</label><input autoComplete="current-password" id="password" maxLength={128} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></div>{error && <p className="alert error" role="alert">{error}</p>}<button className="button" disabled={loading} type="submit">{loading ? 'Entrando...' : 'Entrar'}</button></form></section></main>;
}
