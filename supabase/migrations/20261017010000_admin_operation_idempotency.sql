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
