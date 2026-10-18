begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'rls-admin@example.test', '', now()),
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'rls-inactive-admin@example.test', '', now());

insert into public.administradores (id, nome, ativo)
values
  ('00000000-0000-4000-8000-000000000011', 'RLS Admin', true),
  ('00000000-0000-4000-8000-000000000012', 'RLS Inactive Admin', false);

insert into public.usuarios_gerenciados (id, auth_user_id, nome, email, setor, status)
values (
  '00000000-0000-4000-8000-000000000013',
  null,
  'Managed RLS User',
  'rls-managed@example.test',
  'ti',
  'pendente'
), (
  '00000000-0000-4000-8000-000000000015',
  null,
  'Managed Invite User',
  'rls-invite@example.test',
  'suprimentos',
  'pendente'
);

select public.complete_managed_user_operation(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000013',
  'create',
  '00000000-0000-4000-8000-000000000014',
  'aprovado',
  null
);
select public.complete_managed_user_operation(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000015',
  'invite',
  '00000000-0000-4000-8000-000000000016',
  null,
  null
);
select public.complete_managed_user_operation(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000013',
  'reset',
  '00000000-0000-4000-8000-000000000014',
  null,
  null
);
select public.complete_managed_user_operation(
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000013',
  'create',
  '00000000-0000-4000-8000-000000000014',
  'aprovado',
  null
);

do $$
begin
  if (select status from public.usuarios_gerenciados where id = '00000000-0000-4000-8000-000000000013') <> 'aprovado'
    or (select auth_user_id from public.usuarios_gerenciados where id = '00000000-0000-4000-8000-000000000013')
      <> '00000000-0000-4000-8000-000000000014' then
    raise exception 'managed-user creation did not atomically approve and link the account';
  end if;
  if (select count(*) from public.auditoria_administrativa
      where usuario_id = '00000000-0000-4000-8000-000000000013'
        and acao = 'criou'
        and detalhes->>'credencial' = 'senha_temporaria') <> 1 then
    raise exception 'temporary-password creation audit was missing or duplicated';
  end if;
  if (select status from public.usuarios_gerenciados where id = '00000000-0000-4000-8000-000000000015') <> 'pendente'
    or (select auth_user_id from public.usuarios_gerenciados where id = '00000000-0000-4000-8000-000000000015')
      <> '00000000-0000-4000-8000-000000000016'
    or (select count(*) from public.auditoria_administrativa
        where usuario_id = '00000000-0000-4000-8000-000000000015'
          and acao = 'criou') <> 1 then
    raise exception 'invitation identity link or audit regression';
  end if;
  if (select count(*) from public.auditoria_administrativa
      where usuario_id = '00000000-0000-4000-8000-000000000013'
        and acao = 'solicitou_reset') <> 1 then
    raise exception 'password reset audit regression';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.usuarios_gerenciados', 'INSERT')
    or has_table_privilege('authenticated', 'public.usuarios_gerenciados', 'UPDATE')
    or has_table_privilege('authenticated', 'public.usuarios_gerenciados', 'DELETE')
    or has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') then
    raise exception 'administrative client privilege regression';
  end if;
  if not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') then
    raise exception 'authenticated role cannot evaluate its admin policy';
  end if;
  if not has_table_privilege('service_role', 'public.administradores', 'SELECT')
    or not has_table_privilege('service_role', 'public.usuarios_gerenciados', 'SELECT')
    or not has_table_privilege('service_role', 'public.usuarios_gerenciados', 'INSERT')
    or not has_table_privilege('service_role', 'public.usuarios_gerenciados', 'UPDATE')
    or not has_table_privilege('service_role', 'public.auditoria_administrativa', 'INSERT') then
    raise exception 'Edge Function service role is missing required table privileges';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.usuarios_gerenciados) <> 2
    or (select count(*) from public.auditoria_administrativa) <> 3
    or (select count(*) from public.administradores) <> 1 then
    raise exception 'active administrator read policy regression';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.usuarios_gerenciados) <> 0
    or (select count(*) from public.auditoria_administrativa) <> 0
    or (select count(*) from public.administradores) <> 0 then
    raise exception 'inactive administrator retained data access';
  end if;
end;
$$;

rollback;
