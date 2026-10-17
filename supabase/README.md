# Banco do GFacilERP

Este projeto Supabase e separado do FacilERP. A configuracao local da CLI esta
em `config.toml`; as migrations registram o baseline e a restricao das
mutacoes diretas de usuarios gerenciados. Uma migration local adicional
implementa rate limit persistente, outra torna atomicos os estados e a
auditoria, e uma migration de idempotencia protege repeticoes das operacoes
administrativas.

## Estado remoto em 16/10/2026

- Projeto: `jqjvzypalurnhbkqlzpx` (PostgreSQL 17.11).
- Backup manual de roles, schema e dados confirmado fora do repositorio em
  `Documents/Supabase-Backups/g-facil-erp-20261016-211720`.
- Baseline reconciliado; migration `20261016221412_restrict_direct_user_writes`
  aplicada para remover escritas diretas pelo papel `authenticated`.
- Validado no banco: `usuarios_gerenciados` concede somente `SELECT` e tem
  somente policy de leitura para clientes autenticados.
- Historico `supabase_migrations.schema_migrations` consultado e alinhado com
  as duas migrations remotas existentes. As migrations locais de rate limit e
  auditoria atomica ainda nao foram aplicadas remotamente.
- Migrations aplicadas apos backup manual; `authenticated` tem apenas
  permissao `SELECT` em `usuarios_gerenciados`. Nenhuma operacao de escrita
  administrativa esta disponivel no frontend.

## Estado da integracao administrativa

Administradores autenticam neste projeto, mas as contas operacionais e os
perfis do FacilERP pertencem a outro projeto Supabase. Um JWT emitido aqui nao
autoriza chamadas no projeto do FacilERP. O contrato escolhido e M2M assinado
por RSA; sua implementacao local server-side valida o administrador ativo,
executa mutacoes apenas no FacilERP e registra auditoria no GFacilERP. Nenhuma
chave privilegiada vai ao navegador, Git ou chat. A aprovacao, o bloqueio/
desbloqueio e a mudanca de setor atualizam o estado gerenciado e gravam a
auditoria em uma unica transacao no GFacilERP.

O Storage privado de anexos e os scripts locais de backup/restauracao de
objetos binarios foram implementados e verificados no FacilERP. O backup dos
objetos dos ambientes remotos e a validacao/restauracao em staging continuam
pendentes; dumps SQL nao incluem esses arquivos.

## Implementacao M2M local

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

O codigo e local e ainda nao foi implantado. As Edge Functions compilaram no
runtime local; assinatura RSA, hash do corpo, expiracao, anti-replay e RLS
para perfil inativo foram verificados localmente. A migration
`20261016224000_add_admin_rate_limits.sql` acrescenta limite persistente de
10 operacoes administrativas por administrador a cada 60 segundos. A
migration foi validada em PostgreSQL 17.11 descartavel e aplicada ao Supabase
local. A migration `20261016225100_atomic_managed_user_audit.sql` grava estado
e auditoria atomicamente, evita duplicar eventos em repeticoes sem efeito e
foi aplicada e testada no Supabase local. Nenhuma das duas foi aplicada
remotamente. A migration `20261016233000_harden_admin_rls.sql` fixa o
`search_path` de `is_admin()`, restringe sua execucao e revalida que o cliente
autenticado so pode ler dados autorizados por RLS. A migration
`20261016233100_harden_updated_at_trigger.sql` tambem fixa o `search_path`
do trigger de atualizacao. Os testes locais confirmaram leitura para
administrador ativo, bloqueio de inativo e ausencia de grants de escrita
direta. Essas migrations ainda nao foram aplicadas remotamente. Antes de
habilitar o fluxo:

- gerar o par RSA fora do repositorio e carregar cada chave diretamente como
  secret no projeto correto; nao compartilhar o valor em chat;
- configurar a URL de redirecionamento de convite/recuperacao e o SMTP do
  projeto FacilERP;
- exigir TOTP para administradores e aplicar a politica de senha de 12
  caracteres com classes requeridas nos projetos remotos, após revisar o
  impacto para contas existentes;
- aplicar primeiro a migration do FacilERP em staging e repetir a verificacao
  de que `ativo = false` bloqueia as policies;
- completar testes negativos em staging para nao-admin, expiracao, falha
  parcial, duplicidade e limite de taxa;
- validar em staging a chave de idempotencia para operacoes de criacao,
  aprovacao, alteracao de setor/status e redefinicao. A migration
  `20261017010000_admin_operation_idempotency.sql` e as assertions
  `supabase/tests/admin_idempotency.sql` passaram no Supabase local PostgreSQL
  17.11; a migration continua sem aplicacao remota;
- repetir enrollment TOTP, gate AAL2, revogacao global e bloqueio de
  administradores inativos em staging antes de uso amplo em producao.

TOTP esta habilitado somente na configuracao local (`auth.mfa.totp`) e foi
exercitado contra o Auth real local: senha curta rejeitada, enrollment,
challenge/verificacao em AAL2 e revogacao de refresh tokens de outra sessao.
O FacilERP local validou envio do e-mail de recuperacao pelo Mailpit, retorno a
`/redefinir-senha` e troca de senha. As configuracoes remotas, SMTP e
validacao operacional ainda nao foram alterados nem exercitados.

A idempotencia administrativa calcula hash apenas do payload validado,
reserva a chave por administrador, rejeita reuso com payload diferente,
bloqueia operacoes simultaneas e persiste status/corpo da resposta para replay.
A interface mantem a mesma chave em falhas de transporte, limite de taxa e
operacoes ainda em andamento. A migration foi aplicada no Supabase local
PostgreSQL 17.11 e o teste transacional passou com rollback dos dados de teste.
Nenhum banco Supabase remoto foi alterado.
As duas Edge Functions passaram no Deno type-check e o teste cruzado M2M entre
emissor e receptor aceitou uma assinatura valida e rejeitou uma adulterada.
O fluxo completo com Auth/servicos locais e staging ainda precisa ser exercitado.

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
