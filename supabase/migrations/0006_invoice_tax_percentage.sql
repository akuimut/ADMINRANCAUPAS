begin;

alter table public.invoices
  add column tax_percent numeric(6, 3) not null default 0
  check (tax_percent between 0 and 100);

with item_discounts as (
  select company_id, invoice_id, coalesce(sum(discount), 0) as amount
  from public.invoice_items
  group by company_id, invoice_id
)
update public.invoices i
set tax_percent = case
  when greatest(0, i.subtotal - coalesce(d.amount, 0) - i.discount) > 0
    then pg_catalog.round(
      i.tax::numeric * 100
      / greatest(0, i.subtotal - coalesce(d.amount, 0) - i.discount), 1
    )
  else 0
end
from item_discounts d
where d.company_id = i.company_id and d.invoice_id = i.id;

alter function public.create_company_invoice(uuid, jsonb)
  rename to create_company_invoice_base;
alter function public.update_company_invoice(uuid, uuid, jsonb)
  rename to update_company_invoice_base;

revoke all on function public.create_company_invoice_base(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_company_invoice_base(uuid, uuid, jsonb)
  from public, anon, authenticated;

create function public.create_company_invoice(
  p_company_id uuid,
  p_invoice jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_rate numeric;
  v_subtotal bigint;
  v_discount bigint;
  v_item_discount bigint;
  v_tax bigint;
  v_taxable numeric;
begin
  v_rate := coalesce((p_invoice->>'tax_percent')::numeric, 0);
  if v_rate not between 0 and 100 then
    raise exception 'Persentase pajak harus antara 0 dan 100.' using errcode = '22023';
  end if;

  v_invoice_id := public.create_company_invoice_base(p_company_id, p_invoice);

  select i.subtotal, i.discount, i.tax
  into v_subtotal, v_discount, v_tax
  from public.invoices i
  where i.company_id = p_company_id and i.id = v_invoice_id;

  select coalesce(sum(ii.discount), 0)
  into v_item_discount
  from public.invoice_items ii
  where ii.company_id = p_company_id and ii.invoice_id = v_invoice_id;

  v_taxable := greatest(0, v_subtotal - v_discount - v_item_discount);
  if v_tax <> pg_catalog.round(v_taxable * v_rate / 100)::bigint then
    raise exception 'Nominal pajak tidak sesuai dengan persentasenya.' using errcode = '22023';
  end if;

  update public.invoices
  set tax_percent = v_rate
  where company_id = p_company_id and id = v_invoice_id;

  return v_invoice_id;
end;
$$;

create function public.update_company_invoice(
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
  v_rate numeric;
  v_subtotal bigint;
  v_discount bigint;
  v_item_discount bigint;
  v_tax bigint;
  v_taxable numeric;
begin
  v_rate := coalesce((p_invoice->>'tax_percent')::numeric, 0);
  if v_rate not between 0 and 100 then
    raise exception 'Persentase pajak harus antara 0 dan 100.' using errcode = '22023';
  end if;

  perform public.update_company_invoice_base(p_company_id, p_invoice_id, p_invoice);

  select i.subtotal, i.discount, i.tax
  into v_subtotal, v_discount, v_tax
  from public.invoices i
  where i.company_id = p_company_id and i.id = p_invoice_id;

  select coalesce(sum(ii.discount), 0)
  into v_item_discount
  from public.invoice_items ii
  where ii.company_id = p_company_id and ii.invoice_id = p_invoice_id;

  v_taxable := greatest(0, v_subtotal - v_discount - v_item_discount);
  if v_tax <> pg_catalog.round(v_taxable * v_rate / 100)::bigint then
    raise exception 'Nominal pajak tidak sesuai dengan persentasenya.' using errcode = '22023';
  end if;

  update public.invoices
  set tax_percent = v_rate
  where company_id = p_company_id and id = p_invoice_id;
end;
$$;

revoke all on function public.create_company_invoice(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_company_invoice(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_company_invoice(uuid, jsonb) to authenticated;
grant execute on function public.update_company_invoice(uuid, uuid, jsonb) to authenticated;

commit;