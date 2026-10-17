create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.atualizado_em = timezone('utc', now());
  return new;
end;
$$;
