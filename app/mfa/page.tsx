'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '../../lib/supabase';

type TotpFactor = { id: string; status: string; friendly_name?: string };

export default function MfaPage() {
  const router = useRouter();
  const [factor, setFactor] = useState<TotpFactor | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    async function loadFactors() {
      try {
        const supabase = getSupabaseClient();
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          router.replace('/login');
          return;
        }
        const { data: administrator, error: adminError } = await supabase
          .from('administradores')
          .select('id')
          .eq('id', userData.user.id)
          .eq('ativo', true)
          .maybeSingle();
        if (adminError) throw adminError;
        if (!administrator) {
          await supabase.auth.signOut();
          router.replace('/login');
          return;
        }
        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError) throw assuranceError;
        if (assurance.currentLevel === 'aal2') {
          router.replace('/usuarios');
          return;
        }
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const verified = factors.all.find(
          (item) => item.factor_type === 'totp' && item.status === 'verified',
        );
        const pending = factors.all.find(
          (item) => item.factor_type === 'totp' && item.status === 'unverified',
        );
        setFactor(verified ?? null);
        setPendingFactorId(pending?.id ?? '');
      } catch (caughtError) {
        console.error('Falha ao carregar fatores MFA:', caughtError);
        setError('Não foi possível validar a configuração de autenticação multifator.');
      } finally {
        setLoading(false);
      }
    }
    void loadFactors();
  }, [router]);

  async function startChallenge(factorId: string) {
    const supabase = getSupabaseClient();
    const { data, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    setChallengeId(data.id);
    setFactor({ id: factorId, status: 'unverified' });
    setError('');
  }

  async function enrollTotp() {
    setWorking(true);
    setError('');
    setMessage('');
    try {
      const supabase = getSupabaseClient();
      if (pendingFactorId) {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({
          factorId: pendingFactorId,
        });
        if (unenrollError) throw unenrollError;
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'GFacilERP',
      });
      if (enrollError) throw enrollError;
      setPendingFactorId(data.id);
      setQrCode(`data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`);
      setSecret(data.totp.secret);
      await startChallenge(data.id);
      setMessage('Escaneie o QR com um aplicativo autenticador e informe o código gerado.');
    } catch (caughtError) {
      console.error('Falha ao configurar MFA:', caughtError);
      setError('Não foi possível iniciar a configuração multifator.');
    } finally {
      setWorking(false);
    }
  }

  async function challengeVerifiedFactor() {
    if (!factor) return;
    setWorking(true);
    setError('');
    try {
      await startChallenge(factor.id);
      setMessage('Informe o código atual do aplicativo autenticador.');
    } catch (caughtError) {
      console.error('Falha ao iniciar desafio MFA:', caughtError);
      setError('Não foi possível iniciar a verificação multifator.');
    } finally {
      setWorking(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor?.id || !challengeId || !/^\d{6}$/.test(code.trim())) {
      setError('Informe o código de seis dígitos do aplicativo autenticador.');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance.currentLevel !== 'aal2') {
        throw new Error('The session did not reach the required assurance level.');
      }
      router.replace('/usuarios');
    } catch (caughtError) {
      console.error('Falha ao verificar MFA:', caughtError);
      setError('Código inválido ou expirado. Gere um novo código e tente novamente.');
      setCode('');
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="mfa-title" className="card login-card">
        <p className="brand">GFACILERP</p>
        <h1 id="mfa-title">Autenticação multifator</h1>
        <p>O acesso administrativo exige uma verificação por aplicativo autenticador.</p>
        {loading ? <p role="status">Validando sessão e fatores...</p> : (
          <>
            {error && <p className="alert error" role="alert">{error}</p>}
            {message && <p className="alert success" role="status">{message}</p>}
            {factor && !challengeId && (
              <button className="button" disabled={working} onClick={() => void challengeVerifiedFactor()} type="button">
                {working ? 'Aguarde...' : 'Usar aplicativo autenticador'}
              </button>
            )}
            {!factor && !qrCode && (
              <div>
                <p className="alert">Configure TOTP para habilitar o acesso. Use um aplicativo autenticador confiável.</p>
                <button className="button" disabled={working} onClick={() => void enrollTotp()} type="button">
                  {working ? 'Preparando...' : pendingFactorId ? 'Reiniciar configuração MFA' : 'Configurar MFA'}
                </button>
              </div>
            )}
            {qrCode && <div className="mfa-enrollment">
              <img alt="QR para cadastro do autenticador" className="mfa-qr" src={qrCode} />
              <p>Se não puder ler o QR, informe esta chave manualmente no aplicativo:</p>
              <code className="mfa-secret">{secret}</code>
            </div>}
            {challengeId && (
              <form className="mfa-form" onSubmit={verifyCode}>
                <label className="field" htmlFor="totp-code">
                  Código de verificação
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    id="totp-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    pattern="[0-9]{6}"
                    required
                    value={code}
                  />
                </label>
                <button className="button" disabled={working || code.length !== 6} type="submit">
                  {working ? 'Verificando...' : 'Verificar e continuar'}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
