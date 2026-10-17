drop policy if exists "Admins criam usuários gerenciados"
  on public.usuarios_gerenciados;
drop policy if exists "Admins alteram usuários gerenciados"
  on public.usuarios_gerenciados;
drop policy if exists "Admins excluem usuários gerenciados"
  on public.usuarios_gerenciados;

revoke all on public.administradores, public.usuarios_gerenciados, public.auditoria_administrativa
  from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke references, trigger, truncate, maintain on tables from anon, authenticated;
grant select on public.usuarios_gerenciados to authenticated;
grant select on public.administradores, public.auditoria_administrativa to authenticated;