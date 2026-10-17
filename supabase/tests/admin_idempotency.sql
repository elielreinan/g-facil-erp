begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values (
  '00000000-0000-4000-8000-000000000021',
  'authenticated',
  'authenticated',
  'idempotency-admin@example.test',
  '',
  now()
);

insert into public.administradores (id, nome, ativo)
values ('00000000-0000-4000-8000-000000000021', 'Idempotency Admin', true);

do $$
declare
  result record;
  request_id constant uuid := '10000000-0000-4000-8000-000000000021';
  admin_id constant uuid := '00000000-0000-4000-8000-000000000021';
  request_hash constant text := repeat('a', 64);
  response_body constant jsonb := '{"user_id":"20000000-0000-4000-8000-000000000021","status":"aprovado"}';
begin
  select * into result from public.begin_admin_idempotent_request(
    admin_id, request_id, request_hash
  );
  if result.outcome <> 'started' then
    raise exception 'first operation was not claimed';
  end if;

  select * into result from public.begin_admin_idempotent_request(
    admin_id, request_id, request_hash
  );
  if result.outcome <> 'in_progress' then
    raise exception 'repeated pending operation was not blocked';
  end if;

  select * into result from public.begin_admin_idempotent_request(
    admin_id, request_id, repeat('b', 64)
  );
  if result.outcome <> 'conflict' then
    raise exception 'same idempotency key accepted a different request';
  end if;

  perform public.complete_admin_idempotent_request(
    admin_id, request_id, request_hash, 201, response_body
  );
  select * into result from public.begin_admin_idempotent_request(
    admin_id, request_id, request_hash
  );
  if result.outcome <> 'completed'
    or result.response_status <> 201
    or result.response_body <> response_body then
    raise exception 'completed response was not replayed exactly';
  end if;

  begin
    perform public.begin_admin_idempotent_request(
      '00000000-0000-4000-8000-000000000022',
      '10000000-0000-4000-8000-000000000022',
      request_hash
    );
    raise exception 'inactive administrator unexpectedly claimed an operation';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;
