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
);

insert into public.auditoria_administrativa (administrador_id, acao, usuario_id)
values (
  '00000000-0000-4000-8000-000000000011',
  'criou',
  '00000000-0000-4000-8000-000000000013'
);

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
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.usuarios_gerenciados) <> 1
    or (select count(*) from public.auditoria_administrativa) <> 1
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
