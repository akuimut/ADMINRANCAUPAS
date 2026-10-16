begin;

create or replace function public.next_invoice_number(
  p_company_id uuid,
  p_type public.invoice_type
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_timezone text;
  v_counter bigint;
  v_counter_text text;
  v_invoice_year integer;
begin
  if auth.uid() is null or p_type is null or not exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and c.owner_id = (select auth.uid())
  ) then
    raise exception 'Company tidak ditemukan atau tidak dapat diakses.'
      using errcode = '42501';
  end if;

  select c.invoice_timezone
  into v_timezone
  from public.companies c
  where c.id = p_company_id
    and c.owner_id = (select auth.uid());

  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = v_timezone
  ) then
    raise exception 'Timezone invoice perusahaan belum dipilih atau tidak valid.'
      using errcode = '22023';
  end if;

  select s.invoice_prefix
  into v_prefix
  from public.company_settings s
  where s.company_id = p_company_id;

  if not found then
    raise exception 'Pengaturan perusahaan belum dibuat.'
      using errcode = '23502';
  end if;

  insert into public.invoice_sequences (company_id, next_value)
  select s.company_id, s.invoice_counter
  from public.company_settings s
  where s.company_id = p_company_id
  on conflict (company_id) do nothing;

  update public.invoice_sequences
  set next_value = next_value + 1,
      updated_at = now()
  where company_id = p_company_id
  returning next_value - 1 into v_counter;

  if not found then
    raise exception 'Counter invoice tidak dapat dialokasikan.';
  end if;

  update public.company_settings
  set invoice_counter = v_counter + 1,
      updated_at = now()
  where company_id = p_company_id;

  if not found then
    raise exception 'Counter pengaturan invoice tidak dapat diperbarui.';
  end if;

  v_invoice_year := extract(year from pg_catalog.timezone(v_timezone, now()))::integer;
  v_counter_text := case
    when v_counter < 10000 then pg_catalog.lpad(v_counter::text, 4, '0')
    else v_counter::text
  end;

  return (case p_type when 'sale' then 'INV' else 'BILL' end)
    || '/' || v_prefix
    || '/' || v_invoice_year::text
    || '/' || v_counter_text;
end;
$$;

revoke all on function public.next_invoice_number(uuid, public.invoice_type) from public, anon, authenticated;
grant execute on function public.next_invoice_number(uuid, public.invoice_type) to authenticated;

commit;
