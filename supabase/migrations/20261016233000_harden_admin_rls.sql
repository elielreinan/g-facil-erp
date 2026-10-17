create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.administradores
    where id = auth.uid()
      and ativo
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

alter table public.administradores enable row level security;
alter table public.usuarios_gerenciados enable row level security;
alter table public.auditoria_administrativa enable row level security;

revoke all on public.administradores, public.usuarios_gerenciados,
  public.auditoria_administrativa from public, anon, authenticated;
grant select on public.administradores, public.usuarios_gerenciados,
  public.auditoria_administrativa to authenticated;

drop policy if exists "Admins criam usuários gerenciados"
  on public.usuarios_gerenciados;
drop policy if exists "Admins alteram usuários gerenciados"
  on public.usuarios_gerenciados;
drop policy if exists "Admins excluem usuários gerenciados"
  on public.usuarios_gerenciados;
drop policy if exists "Admins leem usuários gerenciados"
  on public.usuarios_gerenciados;
create policy "Admins leem usuários gerenciados"
  on public.usuarios_gerenciados for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins leem seu perfil" on public.administradores;
create policy "Admins leem seu perfil"
  on public.administradores for select to authenticated
  using (id = auth.uid() and public.is_admin());

drop policy if exists "Admins leem auditoria" on public.auditoria_administrativa;
create policy "Admins leem auditoria"
  on public.auditoria_administrativa for select to authenticated
  using (public.is_admin());

revoke references, trigger, truncate, maintain
  on all tables in schema public from anon, authenticated;
