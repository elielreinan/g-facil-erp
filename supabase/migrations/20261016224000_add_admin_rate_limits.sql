create table public.admin_rate_limits (
  administrador_id uuid not null references public.administradores(id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (administrador_id, bucket_start)
);

alter table public.admin_rate_limits enable row level security;
revoke all on public.admin_rate_limits from public, anon, authenticated;
grant all on public.admin_rate_limits to service_role;

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

revoke all on function public.consume_admin_rate_limit(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(uuid, integer, integer)
  to service_role;
