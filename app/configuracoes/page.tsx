'use client';

import { useEffect, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';

export default function SettingsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function checkAccess() {
      try {
        const result = await requireAdmin();
        if (!result.authorized) {
          window.location.replace('/login');
          return;
        }
        setAuthorized(true);
      } catch (caughtError) {
        console.error('Falha ao validar acesso às configurações:', caughtError);
        setError('Não foi possível validar o acesso administrativo.');
      }
    }
    void checkAccess();
  }, []);

  return <div className="layout"><aside className="sidebar"><p className="brand">GFACILERP</p><p className="brand-subtitle">Gestão de acessos</p><nav className="nav"><a href="/usuarios">Usuários</a><a href="/auditoria">Auditoria</a><a className="active" href="/configuracoes">Configurações</a></nav></aside><div className="content"><header className="topbar"><div><small>Administração</small><h1>Configurações</h1></div><span>Ambiente protegido</span></header><main className="main"><section className="card"><h2>Políticas administrativas</h2><p>As alterações sensíveis devem ser realizadas por API server-side com MFA, autorização, rate limit e auditoria.</p>{error && <p className="alert error" role="alert">{error}</p>}{authorized && <p className="alert success" role="status">Acesso administrativo validado.</p>}</section></main></div></div>;
}
