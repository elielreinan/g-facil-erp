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

  if p_operation = 'approve' then
    if managed_user.status = 'aprovado'
      and managed_user.auth_user_id = p_auth_user_id then
      return;
    end if;
    if managed_user.status <> 'pendente'
      or managed_user.auth_user_id is not null
      or p_auth_user_id is null then
      raise exception 'managed user state conflict' using errcode = '40001';
    end if;
    update public.usuarios_gerenciados
      set auth_user_id = p_auth_user_id, status = 'aprovado'
      where id = p_user_id;
    audit_action := 'aprovou';
    audit_details := jsonb_build_object('setor', managed_user.setor);
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

revoke all on function public.complete_managed_user_operation(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_managed_user_operation(uuid, uuid, text, uuid, text, text)
  to service_role;
