begin;

create or replace function public.create_company_workspace(
  p_invoice_timezone text,
  p_company_name text,
  p_company_address text,
  p_phone text,
  p_email text,
  p_website text,
  p_bank_info text,
  p_invoice_prefix text,
  p_default_tax numeric,
  p_payment_terms text,
  p_theme text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_company_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Autentikasi diperlukan.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text, 0)
  );

  if exists (select 1 from public.companies c where c.owner_id = v_owner_id) then
    raise exception 'Akun ini sudah memiliki workspace perusahaan.' using errcode = '23505';
  end if;

  if p_invoice_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = p_invoice_timezone
  ) then
    raise exception 'Zona waktu invoice harus berupa nama IANA yang valid.' using errcode = '22023';
  end if;

  if pg_catalog.btrim(coalesce(p_company_name, '')) = ''
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_invoice_prefix, ''))) not between 1 and 8
    or p_default_tax is null or p_default_tax < 0 or p_default_tax > 100
    or p_theme not in ('light', 'dark') then
    raise exception 'Pengaturan workspace tidak valid.' using errcode = '22023';
  end if;

  insert into public.profiles (id) values (v_owner_id)
  on conflict (id) do nothing;

  insert into public.companies (owner_id, invoice_timezone)
  values (v_owner_id, p_invoice_timezone)
  returning id into v_company_id;

  insert into public.company_settings (
    company_id, id, company_name, company_address, phone, email, website,
    bank_info, invoice_prefix, default_tax, payment_terms, theme
  ) values (
    v_company_id, 'company', pg_catalog.btrim(p_company_name),
    coalesce(p_company_address, ''), coalesce(p_phone, ''), coalesce(p_email, ''),
    coalesce(p_website, ''), coalesce(p_bank_info, ''),
    pg_catalog.upper(pg_catalog.btrim(p_invoice_prefix)), p_default_tax,
    coalesce(p_payment_terms, ''), p_theme
  );

  return v_company_id;
end;
$$;

revoke all on function public.create_company_workspace(text, text, text, text, text, text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.create_company_workspace(text, text, text, text, text, text, text, text, numeric, text, text)
  to authenticated;
revoke insert (owner_id, invoice_timezone) on public.companies from authenticated;

create or replace function public.create_company_invoice(
  p_company_id uuid,
  p_invoice jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.invoice_type;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_line_number integer := 0;
  v_max_safe_integer constant bigint := 9007199254740991;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_items_subtotal numeric := 0;
  v_items_discount numeric := 0;
  v_item_quantity numeric;
  v_item_unit_price bigint;
  v_item_discount bigint;
  v_expected_total bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = (select auth.uid())
  ) then
    raise exception 'Company tidak ditemukan atau tidak dapat diakses.' using errcode = '42501';
  end if;

  if p_invoice is null or pg_catalog.jsonb_typeof(p_invoice) <> 'object'
    or pg_catalog.jsonb_typeof(p_invoice->'items') <> 'array'
    or pg_catalog.jsonb_array_length(p_invoice->'items') = 0 then
    raise exception 'Data invoice atau item tidak valid.' using errcode = '22023';
  end if;

  v_type := (p_invoice->>'type')::public.invoice_type;
  v_subtotal := (p_invoice->>'subtotal')::bigint;
  v_discount := (p_invoice->>'discount')::bigint;
  v_tax := (p_invoice->>'tax')::bigint;
  v_total := (p_invoice->>'total')::bigint;
  if v_subtotal not between 0 and v_max_safe_integer
    or v_discount not between 0 and v_max_safe_integer
    or v_tax not between 0 and v_max_safe_integer
    or v_total not between 0 and v_max_safe_integer then
    raise exception 'Nilai invoice berada di luar rentang aman.' using errcode = '22003';
  end if;

  v_invoice_number := public.next_invoice_number(p_company_id, v_type);
  insert into public.invoices (
    company_id, invoice_number, type, customer_id, party_name, party_address, party_phone,
    issue_date, due_date, subtotal, discount, tax, total, amount_paid, balance_due,
    status, notes
  ) values (
    p_company_id, v_invoice_number, v_type, nullif(p_invoice->>'customer_id', '')::uuid,
    pg_catalog.btrim(p_invoice->>'party_name'), coalesce(p_invoice->>'party_address', ''),
    coalesce(p_invoice->>'party_phone', ''), (p_invoice->>'issue_date')::date,
    nullif(p_invoice->>'due_date', '')::date, v_subtotal, v_discount, v_tax, v_total,
    0, v_total, case when v_total = 0 then 'paid' else 'unpaid' end,
    coalesce(p_invoice->>'notes', '')
  ) returning id into v_invoice_id;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_invoice->'items') loop
    v_line_number := v_line_number + 1;
    v_item_quantity := (v_item->>'quantity')::numeric;
    v_item_unit_price := (v_item->>'unit_price')::bigint;
    v_item_discount := coalesce((v_item->>'discount')::bigint, 0);
    if pg_catalog.btrim(coalesce(v_item->>'description', '')) = ''
      or v_item_quantity <= 0 or pg_catalog.round(v_item_quantity, 2) <> v_item_quantity
      or v_item_unit_price not between 0 and v_max_safe_integer
      or v_item_discount not between 0 and v_max_safe_integer then
      raise exception 'Detail item invoice tidak valid.' using errcode = '22023';
    end if;
    v_items_subtotal := v_items_subtotal + pg_catalog.round(v_item_quantity * v_item_unit_price);
    v_items_discount := v_items_discount + v_item_discount;
    if v_items_subtotal > v_max_safe_integer then
      raise exception 'Subtotal item berada di luar rentang aman.' using errcode = '22003';
    end if;

    insert into public.invoice_items (
      company_id, invoice_id, line_number, product_id, product_code,
      description, quantity, unit, unit_price, discount
    ) values (
      p_company_id, v_invoice_id, v_line_number, nullif(v_item->>'product_id', '')::uuid,
      coalesce(v_item->>'product_code', ''), v_item->>'description',
      (v_item->>'quantity')::numeric, coalesce(v_item->>'unit', 'pcs'),
      (v_item->>'unit_price')::bigint, coalesce((v_item->>'discount')::bigint, 0)
    );
  end loop;

  v_expected_total := case
    when v_subtotal - v_items_discount - v_discount > 0 then v_subtotal - v_items_discount - v_discount + v_tax
    else v_tax
  end;
  if v_items_subtotal <> v_subtotal or v_total <> v_expected_total then
    raise exception 'Total invoice tidak sesuai dengan rincian item.' using errcode = '22023';
  end if;

  return v_invoice_id;
end;
$$;

create or replace function public.update_company_invoice(
  p_company_id uuid,
  p_invoice_id uuid,
  p_invoice jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_item jsonb;
  v_line_number integer := 0;
  v_max_safe_integer constant bigint := 9007199254740991;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
  v_total bigint;
  v_balance_due bigint;
  v_status public.invoice_status;
  v_items_subtotal numeric := 0;
  v_items_discount numeric := 0;
  v_item_quantity numeric;
  v_item_unit_price bigint;
  v_item_discount bigint;
  v_expected_total bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.owner_id = (select auth.uid())
  ) then
    raise exception 'Company tidak ditemukan atau tidak dapat diakses.' using errcode = '42501';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.company_id = p_company_id and i.id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_invoice.status = 'cancelled' then raise exception 'Invoice dibatalkan tidak dapat diubah.' using errcode = '22023'; end if;
  if p_invoice->>'type' <> v_invoice.type::text then raise exception 'Jenis invoice tidak dapat diubah.' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(p_invoice->'items') <> 'array'
    or pg_catalog.jsonb_array_length(p_invoice->'items') = 0 then
    raise exception 'Invoice harus memiliki minimal satu item.' using errcode = '22023';
  end if;

  v_subtotal := (p_invoice->>'subtotal')::bigint;
  v_discount := (p_invoice->>'discount')::bigint;
  v_tax := (p_invoice->>'tax')::bigint;
  v_total := (p_invoice->>'total')::bigint;
  if v_subtotal not between 0 and v_max_safe_integer
    or v_discount not between 0 and v_max_safe_integer
    or v_tax not between 0 and v_max_safe_integer
    or v_total not between v_invoice.amount_paid and v_max_safe_integer then
    raise exception 'Total invoice tidak valid atau lebih kecil dari pembayaran.' using errcode = '22023';
  end if;

  v_balance_due := v_total - v_invoice.amount_paid;
  if v_balance_due <= 0 then
    v_status := 'paid';
  elsif v_invoice.due_date is not null and v_invoice.due_date < pg_catalog.timezone('UTC', now())::date then
    v_status := 'overdue';
  elsif v_invoice.amount_paid <> 0 then
    v_status := 'partial';
  else
    v_status := 'unpaid';
  end if;

  update public.invoices set
    customer_id = nullif(p_invoice->>'customer_id', '')::uuid,
    party_name = pg_catalog.btrim(p_invoice->>'party_name'),
    party_address = coalesce(p_invoice->>'party_address', ''),
    party_phone = coalesce(p_invoice->>'party_phone', ''),
    issue_date = (p_invoice->>'issue_date')::date,
    due_date = nullif(p_invoice->>'due_date', '')::date,
    subtotal = v_subtotal, discount = v_discount, tax = v_tax, total = v_total,
    balance_due = v_balance_due, status = v_status,
    notes = coalesce(p_invoice->>'notes', ''), updated_at = now()
  where company_id = p_company_id and id = p_invoice_id;

  delete from public.invoice_items where company_id = p_company_id and invoice_id = p_invoice_id;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_invoice->'items') loop
    v_line_number := v_line_number + 1;
    v_item_quantity := (v_item->>'quantity')::numeric;
    v_item_unit_price := (v_item->>'unit_price')::bigint;
    v_item_discount := coalesce((v_item->>'discount')::bigint, 0);
    if pg_catalog.btrim(coalesce(v_item->>'description', '')) = ''
      or v_item_quantity <= 0 or pg_catalog.round(v_item_quantity, 2) <> v_item_quantity
      or v_item_unit_price not between 0 and v_max_safe_integer
      or v_item_discount not between 0 and v_max_safe_integer then
      raise exception 'Detail item invoice tidak valid.' using errcode = '22023';
    end if;
    v_items_subtotal := v_items_subtotal + pg_catalog.round(v_item_quantity * v_item_unit_price);
    v_items_discount := v_items_discount + v_item_discount;
    if v_items_subtotal > v_max_safe_integer then
      raise exception 'Subtotal item berada di luar rentang aman.' using errcode = '22003';
    end if;
    insert into public.invoice_items (
      company_id, invoice_id, line_number, product_id, product_code,
      description, quantity, unit, unit_price, discount
    ) values (
      p_company_id, p_invoice_id, v_line_number, nullif(v_item->>'product_id', '')::uuid,
      coalesce(v_item->>'product_code', ''), v_item->>'description',
      (v_item->>'quantity')::numeric, coalesce(v_item->>'unit', 'pcs'),
      (v_item->>'unit_price')::bigint, coalesce((v_item->>'discount')::bigint, 0)
    );
  end loop;

  v_expected_total := case
    when v_subtotal - v_items_discount - v_discount > 0 then v_subtotal - v_items_discount - v_discount + v_tax
    else v_tax
  end;
  if v_items_subtotal <> v_subtotal or v_total <> v_expected_total then
    raise exception 'Total invoice tidak sesuai dengan rincian item.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.delete_company_invoice(
  p_company_id uuid,
  p_invoice_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_amount_paid bigint;
begin
  select c.owner_id into v_owner_id
  from public.companies c where c.id = p_company_id;
  if v_owner_id is null or v_owner_id <> (select auth.uid()) then
    raise exception 'Company tidak ditemukan atau tidak dapat diakses.' using errcode = '42501';
  end if;

  select i.amount_paid into v_amount_paid
  from public.invoices i
  where i.company_id = p_company_id and i.id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_amount_paid <> 0 then
    raise exception 'Invoice dengan pembayaran tercatat tidak dapat dihapus.' using errcode = '22023';
  end if;

  delete from public.invoices where company_id = p_company_id and id = p_invoice_id;
end;
$$;

revoke all on function public.create_company_invoice(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_company_invoice(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delete_company_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_company_invoice(uuid, jsonb) to authenticated;
grant execute on function public.update_company_invoice(uuid, uuid, jsonb) to authenticated;
grant execute on function public.delete_company_invoice(uuid, uuid) to authenticated;

alter publication supabase_realtime add table
  public.customers, public.products, public.invoices, public.invoice_items,
  public.payments, public.transactions, public.company_settings;

commit;