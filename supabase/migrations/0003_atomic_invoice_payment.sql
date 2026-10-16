begin;

create or replace function public.record_invoice_payment(
  p_company_id uuid,
  p_invoice_id uuid,
  p_idempotency_key uuid,
  p_payment_date date,
  p_amount bigint,
  p_method text,
  p_reference_number text default '',
  p_notes text default ''
)
returns table (
  payment_id uuid,
  transaction_id uuid,
  invoice_id uuid,
  amount bigint,
  amount_paid bigint,
  balance_due bigint,
  status public.invoice_status,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_invoice public.invoices%rowtype;
  v_existing public.payments%rowtype;
  v_payment public.payments%rowtype;
  v_transaction_id uuid;
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status public.invoice_status;
  v_cash_type public.transaction_type;
  v_category text;
  v_description text;
  v_transaction_number text;
  v_now timestamptz := clock_timestamp();
  v_status_date date := pg_catalog.timezone('UTC', v_now)::date;
  v_max_safe_integer constant bigint := 9007199254740991;
begin
  if auth.uid() is null then
    raise exception 'Autentikasi diperlukan.' using errcode = '42501';
  end if;

  select c.owner_id
  into v_owner_id
  from public.companies c
  where c.id = p_company_id;

  if not found or v_owner_id <> (select auth.uid()) then
    raise exception 'Company tidak ditemukan atau tidak dapat diakses.'
      using errcode = '42501';
  end if;

  if p_idempotency_key is null
    or p_payment_date is null
    or p_amount is null
    or p_amount < 1
    or p_amount > v_max_safe_integer
    or p_method is null
    or pg_catalog.btrim(p_method) = '' then
    raise exception 'Data pembayaran tidak valid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_company_id::text || ':' || p_idempotency_key::text, 0)
  );

  select p.*
  into v_existing
  from public.payments p
  where p.company_id = p_company_id
    and p.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.invoice_id <> p_invoice_id
      or v_existing.payment_date <> p_payment_date
      or v_existing.amount <> p_amount
      or v_existing.method <> p_method
      or v_existing.reference_number <> coalesce(p_reference_number, '')
      or v_existing.notes <> coalesce(p_notes, '') then
      raise exception 'Idempotency key sudah digunakan untuk data pembayaran berbeda.'
        using errcode = '22023';
    end if;

    select i.*
    into v_invoice
    from public.invoices i
    where i.company_id = p_company_id
      and i.id = v_existing.invoice_id;

    if not found then
      raise exception 'Invoice untuk pembayaran tersimpan tidak ditemukan.'
        using errcode = '23503';
    end if;

    select t.id
    into v_transaction_id
    from public.transactions t
    where t.company_id = p_company_id
      and t.payment_id = v_existing.id;

    if not found then
      raise exception 'Transaksi kas untuk pembayaran tersimpan tidak ditemukan.'
        using errcode = '23514';
    end if;

    return query
    select v_existing.id, v_transaction_id, v_invoice.id, v_existing.amount,
      v_invoice.amount_paid, v_invoice.balance_due, v_invoice.status, true;
    return;
  end if;

  select i.*
  into v_invoice
  from public.invoices i
  where i.company_id = p_company_id
    and i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice tidak ditemukan atau tidak dapat diakses.'
      using errcode = '42501';
  end if;

  if v_invoice.status = 'cancelled' then
    raise exception 'Invoice yang dibatalkan tidak dapat menerima pembayaran.'
      using errcode = '22023';
  end if;

  if v_invoice.total > v_max_safe_integer
    or v_invoice.amount_paid > v_max_safe_integer
    or v_invoice.balance_due < -v_max_safe_integer
    or v_invoice.balance_due > v_max_safe_integer then
    raise exception 'Nilai invoice melebihi rentang aman JavaScript number.'
      using errcode = '22003';
  end if;

  if p_amount > v_invoice.balance_due then
    raise exception 'Pembayaran melebihi sisa tagihan.' using errcode = '22023';
  end if;

  v_new_paid := v_invoice.amount_paid + p_amount;
  v_new_balance := v_invoice.total - v_new_paid;

  if v_new_paid > v_max_safe_integer
    or v_new_balance < -v_max_safe_integer
    or v_new_balance > v_max_safe_integer then
    raise exception 'Hasil pembayaran melebihi rentang aman JavaScript number.'
      using errcode = '22003';
  end if;

  v_new_status := v_invoice.status;
  if v_invoice.status not in ('draft', 'cancelled') then
    if v_new_balance <= 0 then
      v_new_status := 'paid';
    elsif v_invoice.due_date is not null and v_invoice.due_date < v_status_date then
      v_new_status := 'overdue';
    elsif v_new_paid <> 0 then
      v_new_status := 'partial';
    else
      v_new_status := 'unpaid';
    end if;
  end if;

  insert into public.payments (
    company_id, invoice_id, payment_date, amount, method,
    reference_number, notes, idempotency_key, created_at
  ) values (
    p_company_id, p_invoice_id, p_payment_date, p_amount, p_method,
    coalesce(p_reference_number, ''), coalesce(p_notes, ''), p_idempotency_key, v_now
  ) returning * into v_payment;

  update public.invoices
  set amount_paid = v_new_paid,
      balance_due = v_new_balance,
      status = v_new_status,
      updated_at = v_now
  where company_id = p_company_id
    and id = p_invoice_id
  returning * into v_invoice;

  if not found then
    raise exception 'Invoice gagal diperbarui.' using errcode = '23503';
  end if;

  if v_invoice.type = 'sale' then
    v_cash_type := 'income';
    v_category := 'Pembayaran invoice';
  else
    v_cash_type := 'expense';
    v_category := 'Pembayaran pemasok';
  end if;
  v_description := 'Pembayaran ' || v_invoice.invoice_number;
  v_transaction_number := 'TRX-'
    || pg_catalog.floor(extract(epoch from v_now) * 1000)::bigint::text
    || '-' || pg_catalog.left(pg_catalog.replace(v_payment.id::text, '-', ''), 8);

  insert into public.transactions (
    company_id, transaction_number, date, type, category, description,
    amount, payment_method, invoice_id, payment_id, notes, created_at
  ) values (
    p_company_id, v_transaction_number, p_payment_date, v_cash_type, v_category,
    v_description, v_payment.amount, v_payment.method, p_invoice_id,
    v_payment.id, v_payment.notes, v_now
  ) returning id into v_transaction_id;

  return query
  select v_payment.id, v_transaction_id, v_invoice.id, v_payment.amount,
    v_invoice.amount_paid, v_invoice.balance_due, v_invoice.status, false;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, uuid, uuid, date, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_invoice_payment(uuid, uuid, uuid, date, bigint, text, text, text)
  to authenticated;

commit;
