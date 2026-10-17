# GFacilERP

Aplicativo administrativo separado do FacilERP para gestão de usuários,
aprovações, setores e auditoria.

## Segurança

- Use um projeto Supabase separado do FacilERP.
- Nunca coloque `service_role`, `sb_secret` ou senha do banco no navegador.
- Criação de usuários Auth, alteração de senha e bloqueio devem ser feitos por
  Edge Functions ou API server-side com autorização administrativa, MFA,
  auditoria e rate limit.
- Consulte `supabase/README.md` antes de aplicar migrations. O baseline e para
  banco vazio; bancos existentes exigem backup, comparação de schema e
  reconciliação do histórico antes de qualquer `db push`.

## Execução

```powershell
npm install
npm run dev
```

## Testes

```powershell
npm test
```

Os testes unitarios cobrem assinatura/verificacao M2M e rejeicao de tokens
alterados ou malformados. Eles nao substituem a validacao integrada em staging.

## Aplicativo desktop para Windows

O GFacilERP pode ser empacotado como instalador NSIS localmente:

```powershell
npm ci
npm run tauri:dev
npm run tauri:build
```

Ao executar os dois aplicativos em desenvolvimento ao mesmo tempo, FacilERP
usa `localhost:3000` e GFacilERP `localhost:3001`.

O instalador fica em `src-tauri/target/release/bundle/nsis/`. O build desktop
gera uma exportacao estatica local, sem publicar o aplicativo na web. As
variaveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` sao
incorporadas ao instalador e devem apontar para o projeto GFacilERP. O
aplicativo precisa de internet para acessar Auth, banco e Edge Functions do
Supabase; nao inclui banco local nem funciona offline.
