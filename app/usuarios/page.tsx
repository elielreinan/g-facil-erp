'use client';

import { FormEvent, useEffect, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';

type ManagedUser = { id: string; nome: string; email: string; setor: string; status: string; criado_em: string };

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadUsers() {
    try {
      const { supabase, authorized } = await requireAdmin();
      if (!authorized) {
        window.location.replace('/login');
        return;
      }
      const { data, error: queryError } = await supabase.from('usuarios_gerenciados').select('id,nome,email,setor,status,criado_em').order('nome');
      if (queryError) throw queryError;
      setUsers(data ?? []);
    } catch (caughtError) {
      console.error('Falha ao carregar usuários:', caughtError);
      setError('Não foi possível carregar os usuários. Verifique a sessão e as policies do GFacilERP.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nome = String(data.get('nome') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const setor = String(data.get('setor') ?? '');
    if (!nome || !email || !setor || !window.confirm(`Confirmar aprovação de ${email}?`)) return;
    setError('Para criar usuários no Supabase Auth, conecte este formulário a uma Edge Function server-side com service role. Nenhum segredo será usado no navegador.');
  }

  return <div className="layout"><aside className="sidebar"><p className="brand">GFACILERP</p><p className="brand-subtitle">Gestão de acessos</p><nav className="nav"><a className="active" href="/usuarios">Usuários</a><a href="/auditoria">Auditoria</a><a href="/configuracoes">Configurações</a></nav></aside><div className="content"><header className="topbar"><div><small>Administração</small><h1>Usuários do FacilERP</h1></div><span>Ambiente protegido</span></header><main className="main"><section className="card"><div className="toolbar"><div><h2>Contas autorizadas</h2><p>Somente usuários persistidos no banco do GFacilERP.</p></div><button className="button" onClick={() => document.getElementById('new-user')?.scrollIntoView()} type="button">Novo usuário</button></div>{error && <p className="alert error" role="alert">{error}</p>}<input aria-label="Buscar usuários" className="search" onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou e-mail" type="search" value={search} /><div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Setor</th><th>Status</th><th>Ações</th></tr></thead><tbody>{!loading && users.filter((user) => `${user.nome} ${user.email}`.toLowerCase().includes(search.toLowerCase())).map((user) => <tr key={user.id}><td>{user.nome}</td><td>{user.email}</td><td>{user.setor}</td><td><span className={`status ${user.status === 'aprovado' ? 'approved' : user.status === 'bloqueado' ? 'blocked' : 'pending'}`}>{user.status}</span></td><td><button className="button secondary" type="button">Editar</button></td></tr>)}</tbody></table>{loading && <p className="empty">Carregando usuários...</p>}{!loading && users.length === 0 && <p className="empty">Nenhum usuário cadastrado.</p>}</div></section><section className="card" id="new-user"><h2>Solicitar usuário</h2><p>O cadastro definitivo deve ser executado por função server-side protegida.</p><form className="form-grid" onSubmit={createUser}><div className="field"><label htmlFor="nome">Nome</label><input id="nome" name="nome" required /></div><div className="field"><label htmlFor="novo-email">E-mail</label><input id="novo-email" name="email" required type="email" /></div><div className="field"><label htmlFor="setor">Setor</label><select defaultValue="" id="setor" name="setor" required><option disabled value="">Selecione</option><option value="suprimentos">Suprimentos</option><option value="orcamentos">Orçamentos</option><option value="ti">TI</option><option value="diretoria">Diretoria</option></select></div><button className="button" type="submit">Enviar para aprovação</button></form></section></main></div></div>;
}
