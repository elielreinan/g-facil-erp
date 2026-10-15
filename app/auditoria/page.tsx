'use client';

import { useEffect, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';

type AuditEvent = { id: string; acao: string; detalhes: Record<string, unknown>; criado_em: string };

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAudit() {
      try {
        const { supabase, authorized } = await requireAdmin();
        if (!authorized) {
          window.location.replace('/login');
          return;
        }
        const { data, error: queryError } = await supabase
          .from('auditoria_administrativa')
          .select('id,acao,detalhes,criado_em')
          .order('criado_em', { ascending: false });
        if (queryError) throw queryError;
        setEvents(data ?? []);
      } catch (caughtError) {
        console.error('Falha ao carregar auditoria:', caughtError);
        setError('Não foi possível carregar a auditoria administrativa.');
      }
    }
    void loadAudit();
  }, []);

  return <div className="layout"><aside className="sidebar"><p className="brand">GFACILERP</p><p className="brand-subtitle">Gestão de acessos</p><nav className="nav"><a href="/usuarios">Usuários</a><a className="active" href="/auditoria">Auditoria</a><a href="/configuracoes">Configurações</a></nav></aside><div className="content"><header className="topbar"><div><small>Administração</small><h1>Auditoria administrativa</h1></div><span>Ambiente protegido</span></header><main className="main"><section className="card"><h2>Eventos registrados</h2><p>Eventos persistidos no banco separado do GFacilERP.</p>{error && <p className="alert error" role="alert">{error}</p>}{events.length === 0 ? <p className="empty">Nenhum evento registrado.</p> : <div className="table-wrap"><table><thead><tr><th>Ação</th><th>Detalhes</th><th>Data</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.acao}</td><td>{JSON.stringify(event.detalhes)}</td><td>{new Date(event.criado_em).toLocaleString('pt-BR')}</td></tr>)}</tbody></table></div>}</section></main></div></div>;
}
