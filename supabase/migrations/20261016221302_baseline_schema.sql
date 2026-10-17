create extension if not exists "pgcrypto";

create table public.administradores (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 150),
  ativo boolean not null default true,
  criado_em timestamptz not null default timezone('utc', now())
);

create table public.usuarios_gerenciados (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  nome text not null check (length(trim(nome)) between 2 and 150),
  email text not null unique check (length(trim(email)) between 5 and 254),
  setor text not null check (setor in ('suprimentos', 'orcamentos', 'ti', 'diretoria')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'bloqueado')),
  criado_em timestamptz not null default timezone('utc', now()),
  atualizado_em timestamptz not null default timezone('utc', now())
);

create table public.auditoria_administrativa (
  id uuid primary key default gen_random_uuid(),
  administrador_id uuid not null references public.administradores(id),
  acao text not null check (acao in ('criou', 'alterou', 'aprovou', 'bloqueou', 'desbloqueou', 'solicitou_reset')),
  usuario_id uuid references public.usuarios_gerenciados(id),
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default timezone('utc', now())
);

create or replace function public.set_atualizado_em()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em = timezone('utc', now());
  return new;
end;
$$;

create trigger usuarios_gerenciados_atualizado_em
before update on public.usuarios_gerenciados
for each row execute function public.set_atualizado_em();

alter table public.administradores enable row level security;
alter table public.usuarios_gerenciados enable row level security;
alter table public.auditoria_administrativa enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.administradores where id = auth.uid() and ativo); $$;

create policy "Admins leem usuários gerenciados"
  on public.usuarios_gerenciados for select to authenticated using (public.is_admin());

create policy "Admins criam usuários gerenciados"
  on public.usuarios_gerenciados for insert to authenticated
  with check (public.is_admin());

create policy "Admins alteram usuários gerenciados"
  on public.usuarios_gerenciados for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Admins excluem usuários gerenciados"
  on public.usuarios_gerenciados for delete to authenticated
  using (public.is_admin());

create policy "Admins leem seu perfil"
  on public.administradores for select to authenticated using (id = auth.uid());

create policy "Admins leem auditoria"
  on public.auditoria_administrativa for select to authenticated using (public.is_admin());

revoke all on public.administradores, public.usuarios_gerenciados, public.auditoria_administrativa from anon;
grant usage on schema public to authenticated;
grant select on public.administradores, public.auditoria_administrativa to authenticated;
grant select, insert, update, delete on public.usuarios_gerenciados to authenticated;
