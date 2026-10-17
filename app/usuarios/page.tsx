'use client';

import { useEffect, useRef, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';
import { SignOutButton } from '../../components/sign-out-button';

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
  { action: 'set_status'; user_id: string; status: 'aprovado' | 'bloqueado' }
  | { action: 'set_sector'; user_id: string; setor: Sector };

const sectors: Array<{ value: Sector; label: string }> = [
  { value: 'suprimentos', label: 'Suprimentos' },
  { value: 'orcamentos', label: 'Orçamentos' },
  { value: 'ti', label: 'TI' },
  { value: 'diretoria', label: 'Diretoria' },
];

function isOperationInProgress(value: unknown): boolean {
  return typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    value.error === 'operation_in_progress';
}

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [sectorDrafts, setSectorDrafts] = useState<Record<string, Sector>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState('');
  const idempotencyKeys = useRef(new Map<string, string>());

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
    const actionKey = JSON.stringify(action);
    let idempotencyKey = idempotencyKeys.current.get(actionKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      idempotencyKeys.current.set(actionKey, idempotencyKey);
    }
    const { error: functionError } = await supabase.functions.invoke('manage-managed-user', {
      body: { ...action, idempotency_key: idempotencyKey },
    });
    if (functionError) {
      let retrySameKey = false;
      if (functionError.context instanceof Response) {
        retrySameKey = functionError.context.status === 429;
        if (functionError.context.status === 409) {
          const responseBody: unknown = await functionError.context.clone().json().catch(() => null);
          retrySameKey = isOperationInProgress(responseBody);
        }
      }
      if (!retrySameKey && functionError.context instanceof Response) {
        idempotencyKeys.current.delete(actionKey);
      }
      throw functionError;
    }
    idempotencyKeys.current.delete(actionKey);
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
          <div className="topbar-actions"><span>Ambiente protegido</span><SignOutButton /></div>
        </header>
        <main className="main">
          <section className="card">
            <div className="toolbar">
              <div>
                <h2>Contas autorizadas</h2>
                <p>As alterações são processadas server-side e registradas na auditoria.</p>
              </div>
            </div>
            <p className="alert" role="status">
              Convites e redefinições estão indisponíveis: o SMTP personalizado necessário aos templates OTP ainda não foi configurado.
            </p>
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
                    const busy = busyUserId !== '';
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
                            {user.status === 'pendente' && <span>Aprovação indisponível sem convite por e-mail</span>}
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
        </main>
      </div>
    </div>
  );
}
