# Banco do GFacilERP

Este projeto Supabase e separado do FacilERP. A configuracao local da CLI esta
em `config.toml`; as migrations registram o baseline, a restricao de escrita
direta, o rate limit, a auditoria atomica, a idempotencia e o provisionamento
com senha temporaria.

## Estado remoto em 17/10/2026

- Projeto: `jqjvzypalurnhbkqlzpx` (PostgreSQL 17.11).
- Backup de roles, schema e dados da aplicacao criado fora do repositorio em
  `Documents/Supabase-Backups/g-facil-erp-20261017-201116`. O dump SQL nao
  inclui objetos binarios do Storage nem substitui um teste de restauracao.
- As 10 migrations locais estao aplicadas no projeto remoto. Escritas diretas
  por `authenticated` continuam bloqueadas em `usuarios_gerenciados`.
- A migration `20261017215000_grant_admin_edge_table_privileges.sql` concede
  ao `service_role` somente os privilegios de tabela usados pela Edge Function;
  as permissoes de escrita de `authenticated` permanecem revogadas.
- `manage-managed-user` esta ativa com `verify_jwt=false` no gateway; o handler
  valida explicitamente o bearer recebido, exige MFA AAL2 e administrador
  ativo, e valida a origem do app desktop por CORS.

## Estado da integracao administrativa

Administradores autenticam neste projeto, mas as contas operacionais e os
perfis do FacilERP pertencem a outro projeto Supabase. Um JWT emitido aqui nao
autoriza chamadas no projeto do FacilERP. O contrato escolhido e M2M assinado
por RSA; sua implementacao publicada server-side valida o administrador ativo,
executa mutacoes apenas no FacilERP e registra auditoria no GFacilERP. Nenhuma
chave privilegiada vai ao navegador, Git ou chat. A aprovacao, o bloqueio/
desbloqueio e a mudanca de setor atualizam o estado gerenciado e gravam a
auditoria em uma unica transacao no GFacilERP.

O Storage privado de anexos e os scripts locais de backup/restauracao de
objetos binarios foram implementados e verificados no FacilERP. O backup dos
objetos dos ambientes remotos e a validacao/restauracao em staging continuam
pendentes; dumps SQL nao incluem esses arquivos.

## Provisionamento com senha temporaria

Foi publicado na tela de usuarios um fluxo para criar contas
operacionais do FacilERP com senha temporaria, sem depender de SMTP. A acao
exige administrador ativo com MFA AAL2, validacao forte de senha, limite de
taxa, idempotencia com HMAC server-side e auditoria atomica no GFacilERP.
O segredo trafega somente no corpo HTTPS entre o navegador autenticado e as
Edge Functions; nao e retornado, registrado na auditoria nem escrito em logs.

A conta fica aprovada e vinculada, mas nao consegue consultar dados
operacionais ate trocar a senha no primeiro acesso. Isso e imposto por
`must_change_password` e pelas policies RLS, e a troca ocorre por uma Edge
Function autenticada que confirma a senha temporaria atual.
Como nao ha mensagem de verificacao nesse fluxo, o e-mail fica marcado como
confirmado; o administrador precisa verificar que o endereco pertence a
pessoa autorizada antes do cadastro.

As migrations `20261017193000_require_temporary_password_rotation.sql`
(FacilERP), `20261017020000_restore_managed_user_email_actions.sql` e
`20261017193100_audit_password_user_creation.sql` (GFacilERP), bem como as
Edge Functions atualizadas, estao publicadas. A tentativa inicial deixou uma
solicitacao pendente no GFacilERP, sem conta Auth/perfil/vinculo no FacilERP;
uma falha posterior no provisionamento foi corrigida com grants minimos em
`perfis`. A solicitacao pode ser retomada com o mesmo e-mail e uma nova senha
temporaria, sem criar um segundo registro. Compartilhe senhas somente por
canal seguro.
Convite e reset por email continuam indisponiveis no fluxo de avaliacao
enquanto o SMTP nao estiver configurado.

## Implementacao M2M

Foi escolhida a integracao com assinatura RSA de curta duracao. A Edge
Function `manage-managed-user` exige JWT valido do GFacilERP e confirma que o
usuario e administrador ativo antes de assinar chamadas. A funcao oferece
convite/aprovacao, bloqueio/desbloqueio, alteracao de setor e solicitacao de
redefinicao de senha; as mutacoes sao registradas em
`auditoria_administrativa`.

Secrets necessarias no ambiente Edge do GFacilERP:

- `GFA_CROSS_PROJECT_PRIVATE_KEY_B64`: chave privada PKCS#8 DER codificada em
  Base64, exclusiva do servidor.
- `FACILERP_MANAGEMENT_URL`: endpoint HTTPS da Edge Function receptora no
  projeto FacilERP.
- `ALLOWED_ORIGINS`: lista separada por virgula das origens HTTPS autorizadas
  a chamar a funcao pelo navegador.

A chave publica correspondente deve ser configurada como
`GFA_CROSS_PROJECT_PUBLIC_KEY_B64` no ambiente Edge do FacilERP. O
`SUPABASE_SERVICE_ROLE_KEY` e injetado pelo Supabase no ambiente da Edge
Function e nunca deve ser copiado para o frontend.

Para preparar o par, gere uma chave RSA de pelo menos 3072 bits fora do
repositorio e exporte a privada como PKCS#8 DER Base64 e a publica como
SubjectPublicKeyInfo DER Base64. Carregue cada valor diretamente no secret
store do projeto correspondente; nao cole valores em arquivos versionados,
comandos compartilhados, issues ou chat. Restrinja a URL de redirecionamento
do Auth do FacilERP a `/redefinir-senha` e inclua-a na allowlist de URLs do
projeto. Configure e teste o provedor de e-mail antes de enviar convites.

As migrations remotas habilitam limite persistente de 10 operacoes por
administrador a cada 60 segundos, auditoria atomica, idempotencia e RLS
restritiva. A verificacao pos-deploy confirmou a origem desktop autorizada e
rejeitou chamadas sem autenticacao com HTTP 401. A migration
`20261017193100_audit_password_user_creation.sql` preserva os fluxos existentes
de convite e reset, alem de gravar criacao por senha temporaria sem registrar
a senha.

As credenciais M2M permanecem no secret store dos projetos. SMTP continua
desabilitado; convites/reset por email nao foram testados nem devem ser usados
ate configurar e validar um provedor.

TOTP esta habilitado somente na configuracao local (`auth.mfa.totp`) e foi
exercitado contra o Auth real local: senha curta rejeitada, enrollment,
challenge/verificacao em AAL2 e revogacao de refresh tokens de outra sessao.
O FacilERP local validou envio do e-mail de recuperacao pelo Mailpit, retorno a
`/redefinir-senha` e troca de senha. As configuracoes remotas, SMTP e
validacao operacional ainda nao foram alterados nem exercitados.

A idempotencia administrativa calcula hash apenas do payload validado,
reserva a chave por administrador, rejeita reuso com payload diferente,
bloqueia operacoes simultaneas e persiste status/corpo da resposta para replay.
O fluxo ponta a ponta autenticado com ADM/MFA e uma conta de teste ainda
precisa ser exercitado.

Nao use `db reset` em projetos remotos. Nao coloque senha do banco ou chaves
secret/service_role em variaveis `NEXT_PUBLIC_*`, no frontend ou no Git.

O script `supabase/tests/admin_rls.sql` valida essas regras numa transacao
revertida. Com a stack local ativa:

```powershell
Get-Content -Raw -Path 'C:\caminho\GFacilERP\supabase\tests\admin_rls.sql' |
  docker exec -i supabase_db_g-facil-erp psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

Se o CLI nao conseguir conectar ao PostgreSQL, verifique localmente
`SUPABASE_DB_PASSWORD`; nunca inclua a senha em arquivos versionados ou no chat.

## Ambiente local

`supabase/config.toml` desativa seeds para nao inserir dados demonstrativos.
Antes de iniciar o Postgres local, alinhe `db.major_version` com a versao
remota. A CLI e executada via `npx supabase`; login e sincronizacao remota
exigem autorizacao do operador.
