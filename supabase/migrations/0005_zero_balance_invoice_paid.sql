begin;

create or replace function public.mark_zero_balance_invoice_paid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('draft', 'cancelled') and new.balance_due <= 0 then
    new.status := 'paid';
  end if;
  return new;
end;
$$;

revoke all on function public.mark_zero_balance_invoice_paid() from public, anon, authenticated;

drop trigger if exists invoices_mark_zero_balance_paid on public.invoices;
create trigger invoices_mark_zero_balance_paid
  before insert or update on public.invoices
  for each row execute function public.mark_zero_balance_invoice_paid();

update public.invoices
set status = 'paid', updated_at = now()
where balance_due <= 0 and status not in ('draft', 'cancelled');

commit;