# GFacilERP

Aplicativo administrativo separado do FacilERP para gestão de usuários,
aprovações, setores e auditoria.

## Segurança

- Use um projeto Supabase separado do FacilERP.
- Nunca coloque `service_role`, `sb_secret` ou senha do banco no navegador.
- Criação de usuários Auth, alteração de senha e bloqueio devem ser feitos por
  Edge Functions ou API server-side com autorização administrativa, MFA,
  auditoria e rate limit.
- Execute `supabase/schema.sql` no projeto do GFacilERP antes de testar.

## Execução

```powershell
npm install
npm run dev
```
