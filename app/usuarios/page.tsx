'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { requireAdmin } from '../../lib/admin-access';
import { isStrongPassword } from '../../lib/password';
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
  { action: 'create'; nome: string; email: string; setor: Sector; password: string }
  | { action: 'set_status'; user_id: string; status: 'aprovado' | 'bloqueado' }
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

async function getManagementErrorMessage(error: {
  context?: unknown;
}): Promise<string> {
  if (!(error.context instanceof Response)) {
    return 'Não foi possível conectar ao serviço de gestão. Tente novamente.';
  }

  const status = error.context.status;
  const body: unknown = await error.context.clone().json().catch(() => null);
  const errorCode = typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : '';

  if (errorCode === 'mfa_required') return 'Conclua a autenticação MFA antes de continuar.';
  if (errorCode === 'invalid_token') {
    return 'O token da sessão não foi validado. Entre novamente e conclua a autenticação MFA.';
  }
  if (status === 401) {
    return 'O serviço não reconheceu a sessão atual (HTTP 401). Entre novamente; se acontecer de novo, pare e informe este erro ao suporte.';
  }
  if (errorCode === 'forbidden') return 'Esta conta não tem autorização administrativa ativa.';
  if (errorCode === 'rate_limit_exceeded') return 'Limite de operações atingido. Aguarde um minuto e tente novamente.';
  if (errorCode === 'email_already_registered') return 'Este e-mail já está cadastrado.';
  if (errorCode === 'facil_erp_account_creation_failed') {
    return 'O FacilERP não concluiu o provisionamento. A solicitação existente continua pendente; não crie outro cadastro. Após a correção, tente novamente com o mesmo e-mail e uma nova senha temporária.';
  }

  return `O serviço de gestão retornou HTTP ${status}. Tente novamente; se persistir, consulte os logs do Supabase.`;
}

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [sectorDrafts, setSectorDrafts] = useState<Record<string, Sector>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserSector, setNewUserSector] = useState<Sector>('suprimentos');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
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
    const actionKey = action.action === 'create'
      ? `create:${action.email.toLowerCase()}`
      : JSON.stringify(action);
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
      throw new Error(await getManagementErrorMessage(functionError));
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
      setError(caughtError instanceof Error
        ? caughtError.message
        : 'Não foi possível concluir a operação. Atualize a lista antes de tentar novamente.');
      await loadUsers();
    } finally {
      setBusyUserId('');
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!isStrongPassword(temporaryPassword)) {
      setError('Use uma senha temporária de 12 a 128 caracteres, com minúscula, maiúscula, número e símbolo.');
      return;
    }
    if (temporaryPassword !== passwordConfirmation) {
      setError('As senhas temporárias não coincidem.');
      return;
    }
    if (!authorizationConfirmed) {
      setError('Confirme que está autorizado a criar esta conta e a compartilhar a senha por canal seguro.');
      return;
    }
    if (!window.confirm(`Criar a conta operacional de ${newUserEmail.trim()} no setor selecionado? O acesso ficará bloqueado até a troca da senha temporária.`)) return;

    setBusyUserId('new-user');
    try {
      await callManagement({
        action: 'create',
        nome: newUserName.trim(),
        email: newUserEmail.trim().toLowerCase(),
        setor: newUserSector,
        password: temporaryPassword,
      });
      setMessage('Conta criada. Compartilhe a senha temporária por um canal seguro; o primeiro login exigirá a troca da senha.');
      setNewUserName('');
      setNewUserEmail('');
      setNewUserSector('suprimentos');
      setTemporaryPassword('');
      setPasswordConfirmation('');
      setAuthorizationConfirmed(false);
      await loadUsers();
    } catch (caughtError) {
      console.error('Falha ao criar usuário operacional:', caughtError);
      setTemporaryPassword('');
      setPasswordConfirmation('');
      setError(caughtError instanceof Error
        ? caughtError.message
        : 'Não foi possível criar a conta. Atualize a lista antes de tentar novamente.');
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
              Convites e redefinições por e-mail seguem indisponíveis sem SMTP. Contas podem ser criadas com senha temporária; compartilhe-a por canal seguro. O primeiro acesso exige a troca.
            </p>
            {error && <p className="alert error" role="alert">{error}</p>}
            {message && <p className="alert success" role="status">{message}</p>}
            <form className="form-grid" onSubmit={(event) => void createUser(event)}>
              <h3>Criar conta operacional</h3>
              <label>
                Nome
                <input
                  autoComplete="name"
                  disabled={busyUserId !== ''}
                  maxLength={150}
                  minLength={2}
                  onChange={(event) => setNewUserName(event.target.value)}
                  required
                  value={newUserName}
                />
              </label>
              <label>
                E-mail
                <input
                  autoComplete="email"
                  disabled={busyUserId !== ''}
                  maxLength={254}
                  onChange={(event) => setNewUserEmail(event.target.value)}
                  required
                  type="email"
                  value={newUserEmail}
                />
              </label>
              <label>
                Setor
                <select
                  disabled={busyUserId !== ''}
                  onChange={(event) => setNewUserSector(event.target.value as Sector)}
                  value={newUserSector}
                >
                  {sectors.map((sector) => (
                    <option key={sector.value} value={sector.value}>{sector.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Senha temporária
                <input
                  autoComplete="new-password"
                  disabled={busyUserId !== ''}
                  maxLength={128}
                  minLength={12}
                  onChange={(event) => setTemporaryPassword(event.target.value)}
                  required
                  type="password"
                  value={temporaryPassword}
                />
              </label>
              <label>
                Confirme a senha temporária
                <input
                  autoComplete="new-password"
                  disabled={busyUserId !== ''}
                  maxLength={128}
                  minLength={12}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  required
                  type="password"
                  value={passwordConfirmation}
                />
              </label>
              <p>A senha precisa ter 12–128 caracteres, minúscula, maiúscula, número e símbolo. Nunca a envie por e-mail aberto ou registre em arquivos.</p>
              <label>
                <input
                  checked={authorizationConfirmed}
                  disabled={busyUserId !== ''}
                  onChange={(event) => setAuthorizationConfirmed(event.target.checked)}
                  required
                  type="checkbox"
                />
                Confirmo que tenho autorização para cadastrar este usuário e que o e-mail pertence à pessoa indicada. O Supabase marcará o e-mail como confirmado sem enviar mensagem.
              </label>
              <button className="button" disabled={busyUserId !== ''} type="submit">
                {busyUserId === 'new-user' ? 'Criando...' : 'Criar usuário'}
              </button>
            </form>
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
