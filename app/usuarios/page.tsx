'use client';

import { FormEvent, useEffect, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';

type Sector = 'suprimentos' | 'orcamentos' | 'ti' | 'diretoria';
type ManagedUser = {
  id: string;
  nome: string;
  email: string;
  setor: Sector;
  status: 'pendente' | 'aprovado' | 'bloqueado';
  criado_em: string;
};
type ManagementAction =
  | { action: 'create'; nome: string; email: string; setor: Sector }
  | { action: 'approve' | 'reset'; user_id: string }
  | { action: 'set_status'; user_id: string; status: 'aprovado' | 'bloqueado' }
  | { action: 'set_sector'; user_id: string; setor: Sector };

const sectors: Array<{ value: Sector; label: string }> = [
  { value: 'suprimentos', label: 'Suprimentos' },
  { value: 'orcamentos', label: 'Orçamentos' },
  { value: 'ti', label: 'TI' },
  { value: 'diretoria', label: 'Diretoria' },
];

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [sectorDrafts, setSectorDrafts] = useState<Record<string, Sector>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState('');

  async function loadUsers() {
    try {
      const { supabase, authorized, mfaRequired } = await requireAdmin();
      if (!authorized) {
        window.location.replace(mfaRequired ? '/mfa' : '/login');
        return;
      }
      const { data, error: queryError } = await supabase
        .from('usuarios_gerenciados')
        .select('id,nome,email,setor,status,criado_em')
        .order('nome');
      if (queryError) throw queryError;
      setUsers((data ?? []) as ManagedUser[]);
      setSectorDrafts({});
    } catch (caughtError) {
      console.error('Falha ao carregar usuários:', caughtError);
      setError('Não foi possível carregar os usuários. Verifique a sessão e as policies do GFacilERP.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function callManagement(action: ManagementAction): Promise<void> {
    const { supabase, authorized, mfaRequired } = await requireAdmin();
    if (!authorized) {
      window.location.replace(mfaRequired ? '/mfa' : '/login');
      throw new Error('A sessão administrativa expirou.');
    }
    const { error: functionError } = await supabase.functions.invoke('manage-managed-user', {
      body: action,
    });
    if (functionError) throw functionError;
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const nome = String(data.get('nome') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const setor = String(data.get('setor') ?? '') as Sector;
    if (!nome || !email || !sectors.some((item) => item.value === setor)) return;
    if (!window.confirm(`Criar e aprovar o acesso de ${email}? Um convite será enviado.`)) return;

    setIsCreating(true);
    try {
      await callManagement({ action: 'create', nome, email, setor });
      setMessage(`Convite enviado para ${email}.`);
      form.reset();
      await loadUsers();
    } catch (caughtError) {
      console.error('Falha ao criar usuário gerenciado:', caughtError);
      setError('Não foi possível concluir o convite. Se o usuário aparecer como pendente, tente aprová-lo novamente.');
      await loadUsers();
    } finally {
      setIsCreating(false);
    }
  }

  async function runUserAction(
    user: ManagedUser,
    action: ManagementAction,
    confirmMessage: string,
    successMessage: string,
  ) {
    setError('');
    setMessage('');
    if (!window.confirm(confirmMessage)) return;
    setBusyUserId(user.id);
    try {
      await callManagement(action);
      setMessage(successMessage);
      await loadUsers();
    } catch (caughtError) {
      console.error('Falha na operação administrativa:', caughtError);
      setError('Não foi possível concluir a operação. Atualize a lista antes de tentar novamente.');
      await loadUsers();
    } finally {
      setBusyUserId('');
    }
  }

  const visibleUsers = users.filter((user) =>
    `${user.nome} ${user.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <p className="brand">GFACILERP</p>
        <p className="brand-subtitle">Gestão de acessos</p>
        <nav className="nav">
          <a className="active" href="/usuarios">Usuários</a>
          <a href="/auditoria">Auditoria</a>
          <a href="/configuracoes">Configurações</a>
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          <div>
            <small>Administração</small>
            <h1>Usuários do FacilERP</h1>
          </div>
          <span>Ambiente protegido</span>
        </header>
        <main className="main">
          <section className="card">
            <div className="toolbar">
              <div>
                <h2>Contas autorizadas</h2>
                <p>As alterações são processadas server-side e registradas na auditoria.</p>
              </div>
              <button
                className="button"
                onClick={() => document.getElementById('new-user')?.scrollIntoView()}
                type="button"
              >
                Novo usuário
              </button>
            </div>
            {error && <p className="alert error" role="alert">{error}</p>}
            {message && <p className="alert success" role="status">{message}</p>}
            <input
              aria-label="Buscar usuários"
              className="search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome ou e-mail"
              type="search"
              value={search}
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nome</th><th>E-mail</th><th>Setor</th><th>Status</th><th>Ações</th></tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => {
                    const busy = busyUserId === user.id;
                    const selectedSector = sectorDrafts[user.id] ?? user.setor;
                    return (
                      <tr key={user.id}>
                        <td>{user.nome}</td>
                        <td>{user.email}</td>
                        <td>
                          {user.status === 'aprovado' ? (
                            <div className="form-grid">
                              <select
                                aria-label={`Setor de ${user.nome}`}
                                disabled={busy}
                                onChange={(event) => setSectorDrafts((current) => ({
                                  ...current,
                                  [user.id]: event.target.value as Sector,
                                }))}
                                value={selectedSector}
                              >
                                {sectors.map((sector) => (
                                  <option key={sector.value} value={sector.value}>{sector.label}</option>
                                ))}
                              </select>
                              {selectedSector !== user.setor && (
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => void runUserAction(
                                    user,
                                    { action: 'set_sector', user_id: user.id, setor: selectedSector },
                                    `Alterar o setor de ${user.email}?`,
                                    'Setor atualizado.',
                                  )}
                                  type="button"
                                >
                                  Salvar setor
                                </button>
                              )}
                            </div>
                          ) : sectors.find((sector) => sector.value === user.setor)?.label ?? user.setor}
                        </td>
                        <td>
                          <span className={`status ${user.status === 'aprovado' ? 'approved' : user.status === 'bloqueado' ? 'blocked' : 'pending'}`}>
                            {user.status}
                          </span>
                        </td>
                        <td>
                          <div className="toolbar">
                            {user.status === 'pendente' && (
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => void runUserAction(
                                  user,
                                  { action: 'approve', user_id: user.id },
                                  `Aprovar e enviar convite para ${user.email}?`,
                                  'Usuário aprovado; convite enviado.',
                                )}
                                type="button"
                              >
                                Aprovar
                              </button>
                            )}
                            {user.status === 'aprovado' && (
                              <>
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => void runUserAction(
                                    user,
                                    { action: 'set_status', user_id: user.id, status: 'bloqueado' },
                                    `Bloquear o acesso de ${user.email}?`,
                                    'Acesso bloqueado.',
                                  )}
                                  type="button"
                                >
                                  Bloquear
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={busy}
                                  onClick={() => void runUserAction(
                                    user,
                                    { action: 'reset', user_id: user.id },
                                    `Enviar um link de redefinição de senha para ${user.email}?`,
                                    'Solicitação de redefinição enviada.',
                                  )}
                                  type="button"
                                >
                                  Redefinir senha
                                </button>
                              </>
                            )}
                            {user.status === 'bloqueado' && (
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => void runUserAction(
                                  user,
                                  { action: 'set_status', user_id: user.id, status: 'aprovado' },
                                  `Desbloquear o acesso de ${user.email}?`,
                                  'Acesso desbloqueado.',
                                )}
                                type="button"
                              >
                                Desbloquear
                              </button>
                            )}
                            {busy && <span role="status">Processando...</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {loading && <p className="empty">Carregando usuários...</p>}
              {!loading && visibleUsers.length === 0 && <p className="empty">Nenhum usuário encontrado.</p>}
            </div>
          </section>
          <section className="card" id="new-user">
            <h2>Criar usuário</h2>
            <p>Um convite será enviado ao endereço informado; a pessoa definirá a própria senha.</p>
            <form className="form-grid" onSubmit={createUser}>
              <div className="field">
                <label htmlFor="nome">Nome</label>
                <input autoComplete="name" id="nome" maxLength={150} minLength={2} name="nome" required />
              </div>
              <div className="field">
                <label htmlFor="novo-email">E-mail</label>
                <input autoComplete="email" id="novo-email" maxLength={254} name="email" required type="email" />
              </div>
              <div className="field">
                <label htmlFor="setor">Setor</label>
                <select defaultValue="" id="setor" name="setor" required>
                  <option disabled value="">Selecione</option>
                  {sectors.map((sector) => (
                    <option key={sector.value} value={sector.value}>{sector.label}</option>
                  ))}
                </select>
              </div>
              <button className="button" disabled={isCreating} type="submit">
                {isCreating ? 'Enviando convite...' : 'Criar e aprovar'}
              </button>
            </form>
          </section>
        </main>
      </div>
    </div>
  );
}
