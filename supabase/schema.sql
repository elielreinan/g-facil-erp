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

create table public.admin_rate_limits (
  administrador_id uuid not null references public.administradores(id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (administrador_id, bucket_start)
);

create or replace function public.consume_admin_rate_limit(
  p_admin_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  window_seconds integer := greatest(1, least(p_window_seconds, 3600));
  request_limit integer := greatest(1, least(p_limit, 100));
  current_bucket timestamptz;
begin
  current_bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  );
  delete from public.admin_rate_limits
  where bucket_start < current_bucket - make_interval(secs => window_seconds * 2);
  insert into public.admin_rate_limits (administrador_id, bucket_start, request_count)
  values (p_admin_id, current_bucket, 1)
  on conflict (administrador_id, bucket_start) do update
    set request_count = public.admin_rate_limits.request_count + 1
    where public.admin_rate_limits.request_count < request_limit;
  return found;
end;
$$;

create or replace function public.complete_managed_user_operation(
  p_administrator_id uuid,
  p_user_id uuid,
  p_operation text,
  p_auth_user_id uuid,
  p_status text,
  p_sector text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  managed_user public.usuarios_gerenciados%rowtype;
  audit_action text;
  audit_details jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.administradores
    where id = p_administrator_id and ativo
  ) then
    raise exception 'active administrator required' using errcode = '42501';
  end if;

  select * into managed_user
  from public.usuarios_gerenciados
  where id = p_user_id
  for update;

  if not found then
    raise exception 'managed user not found' using errcode = 'P0002';
  end if;

  if p_operation in ('approve', 'create') then
    if managed_user.status = 'aprovado'
      and managed_user.auth_user_id = p_auth_user_id then
      return;
    end if;
    if managed_user.status <> 'pendente'
      or managed_user.auth_user_id is not null
      or p_auth_user_id is null
      or (p_operation = 'create' and p_status is distinct from 'aprovado') then
      raise exception 'managed user state conflict' using errcode = '40001';
    end if;
    update public.usuarios_gerenciados
      set auth_user_id = p_auth_user_id, status = 'aprovado'
      where id = p_user_id;
    audit_action := case when p_operation = 'create' then 'criou' else 'aprovou' end;
    audit_details := jsonb_build_object(
      'setor', managed_user.setor,
      'credencial', case when p_operation = 'create' then 'senha_temporaria' else 'convite' end
    );
  elsif p_operation = 'set_status' then
    if managed_user.auth_user_id is distinct from p_auth_user_id
      or p_status is null
      or p_status not in ('aprovado', 'bloqueado') then
      raise exception 'managed user state conflict' using errcode = '40001';
    end if;
    if managed_user.status = p_status then
      return;
    end if;
    update public.usuarios_gerenciados
      set status = p_status
      where id = p_user_id;
    audit_action := case when p_status = 'bloqueado' then 'bloqueou' else 'desbloqueou' end;
    audit_details := jsonb_build_object('status', p_status);
  elsif p_operation = 'set_sector' then
    if managed_user.auth_user_id is distinct from p_auth_user_id
      or p_sector is null
      or p_sector not in ('suprimentos', 'orcamentos', 'ti', 'diretoria') then
      raise exception 'managed user state conflict' using errcode = '40001';
    end if;
    if managed_user.setor = p_sector then
      return;
    end if;
    update public.usuarios_gerenciados
      set setor = p_sector
      where id = p_user_id;
    audit_action := 'alterou';
    audit_details := jsonb_build_object(
      'setor_anterior', managed_user.setor,
      'setor_novo', p_sector
    );
  else
    raise exception 'unsupported managed user operation' using errcode = '22023';
  end if;

  insert into public.auditoria_administrativa (
    administrador_id, acao, usuario_id, detalhes
  ) values (
    p_administrator_id, audit_action, p_user_id, audit_details
  );
end;
$$;

create or replace function public.set_atualizado_em()
returns trigger language plpgsql
set search_path = pg_catalog, public
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
alter table public.admin_rate_limits enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.administradores where id = auth.uid() and ativo
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create policy "Admins leem usuários gerenciados"
  on public.usuarios_gerenciados for select to authenticated using (public.is_admin());

create policy "Admins leem seu perfil"
  on public.administradores for select to authenticated
  using (id = auth.uid() and public.is_admin());

create policy "Admins leem auditoria"
  on public.auditoria_administrativa for select to authenticated using (public.is_admin());

revoke all on public.administradores, public.usuarios_gerenciados, public.auditoria_administrativa from anon;
revoke all on public.administradores, public.usuarios_gerenciados, public.auditoria_administrativa
  from public, authenticated;
revoke all on public.admin_rate_limits from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.administradores, public.auditoria_administrativa to authenticated;
grant select on public.usuarios_gerenciados to authenticated;
grant all on public.admin_rate_limits to service_role;
revoke all on function public.consume_admin_rate_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(uuid, integer, integer)
  to service_role;
revoke all on function public.complete_managed_user_operation(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_managed_user_operation(uuid, uuid, text, uuid, text, text)
  to service_role;
revoke references, trigger, truncate, maintain
  on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke references, trigger, truncate, maintain on tables from anon, authenticated;

create table public.admin_operation_idempotency (
  administrator_id uuid not null references public.administradores(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (administrator_id, idempotency_key),
  check (
    (response_status is null and response_body is null and completed_at is null)
    or (
      response_status between 200 and 599
      and response_body is not null
      and completed_at is not null
    )
  )
);

alter table public.admin_operation_idempotency enable row level security;
revoke all on public.admin_operation_idempotency from public, anon, authenticated;
grant all on public.admin_operation_idempotency to service_role;

create or replace function public.begin_admin_idempotent_request(
  p_administrator_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
)
returns table (outcome text, response_status integer, response_body jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inserted_rows integer;
  stored_request public.admin_operation_idempotency%rowtype;
begin
  if not exists (
    select 1 from public.administradores
    where id = p_administrator_id and ativo
  ) then
    raise exception 'active administrator required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid idempotency request' using errcode = '22023';
  end if;

  delete from public.admin_operation_idempotency
  where administrator_id = p_administrator_id
    and completed_at < now() - interval '30 days';

  insert into public.admin_operation_idempotency (
    administrator_id, idempotency_key, request_hash
  ) values (
    p_administrator_id, p_idempotency_key, p_request_hash
  ) on conflict (administrator_id, idempotency_key) do nothing;
  get diagnostics inserted_rows = row_count;

  select * into stored_request
  from public.admin_operation_idempotency
  where administrator_id = p_administrator_id
    and idempotency_key = p_idempotency_key
  for update;

  if stored_request.request_hash <> p_request_hash then
    return query select 'conflict'::text, null::integer, null::jsonb;
  elsif stored_request.response_status is not null then
    return query select
      'completed'::text,
      stored_request.response_status,
      stored_request.response_body;
  elsif inserted_rows = 1 then
    return query select 'started'::text, null::integer, null::jsonb;
  else
    return query select 'in_progress'::text, null::integer, null::jsonb;
  end if;
end;
$$;

create or replace function public.complete_admin_idempotent_request(
  p_administrator_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_response_status integer,
  p_response_body jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.administradores
    where id = p_administrator_id and ativo
  ) then
    raise exception 'active administrator required' using errcode = '42501';
  end if;
  if p_response_status is null
    or p_response_status < 200
    or p_response_status > 599
    or p_response_body is null then
    raise exception 'invalid idempotency response' using errcode = '22023';
  end if;

  update public.admin_operation_idempotency
  set response_status = p_response_status,
      response_body = p_response_body,
      completed_at = now()
  where administrator_id = p_administrator_id
    and idempotency_key = p_idempotency_key
    and request_hash = p_request_hash
    and response_status is null;
  if found then return; end if;

  if exists (
    select 1 from public.admin_operation_idempotency
    where administrator_id = p_administrator_id
      and idempotency_key = p_idempotency_key
      and request_hash = p_request_hash
      and response_status = p_response_status
      and response_body = p_response_body
  ) then
    return;
  end if;
  raise exception 'idempotency request is not pending' using errcode = '40001';
end;
$$;

revoke all on function public.begin_admin_idempotent_request(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_admin_idempotent_request(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.begin_admin_idempotent_request(uuid, uuid, text)
  to service_role;
grant execute on function public.complete_admin_idempotent_request(uuid, uuid, text, integer, jsonb)
  to service_role;
