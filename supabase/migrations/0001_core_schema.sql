begin;

create type public.invoice_type as enum ('sale', 'purchase');
create type public.invoice_status as enum ('draft', 'unpaid', 'partial', 'paid', 'overdue', 'cancelled');
create type public.transaction_type as enum ('income', 'expense');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  invoice_timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  id text not null default 'company' check (id = 'company'),
  company_name text not null default 'RANCAUPAS BEAUTY',
  company_address text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  bank_info text not null default '',
  invoice_prefix varchar(8) not null default 'RB',
  invoice_counter bigint not null default 1 check (invoice_counter between 1 and 9007199254740991),
  default_tax numeric(7, 3) not null default 0 check (default_tax >= 0 and default_tax <= 100),
  payment_terms text not null default '',
  theme text not null default 'light' check (theme in ('light', 'dark')),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_code text not null,
  name text not null,
  company_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_code text not null,
  name text not null,
  category text not null default 'Umum',
  description text not null default '',
  unit text not null default 'pcs',
  selling_price bigint not null default 0 check (selling_price between 0 and 9007199254740991),
  cost_price bigint not null default 0 check (cost_price between 0 and 9007199254740991),
  stock numeric(18, 4) not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (company_id, id)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_number text not null,
  type public.invoice_type not null,
  customer_id uuid,
  party_name text not null,
  party_address text not null default '',
  party_phone text not null default '',
  issue_date date not null,
  due_date date,
  subtotal bigint not null default 0 check (subtotal between 0 and 9007199254740991),
  discount bigint not null default 0 check (discount between 0 and 9007199254740991),
  tax bigint not null default 0 check (tax between 0 and 9007199254740991),
  total bigint not null default 0 check (total between 0 and 9007199254740991),
  amount_paid bigint not null default 0 check (amount_paid between 0 and 9007199254740991),
  balance_due bigint not null default 0 check (balance_due between -9007199254740991 and 9007199254740991),
  status public.invoice_status not null default 'unpaid',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, invoice_number),
  foreign key (company_id, customer_id)
    references public.customers(company_id, id) on delete restrict
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid,
  product_code text not null default '',
  description text not null,
  quantity numeric(18, 2) not null check (quantity > 0),
  unit text not null default 'pcs',
  unit_price bigint not null check (unit_price between 0 and 9007199254740991),
  discount bigint not null default 0 check (discount between 0 and 9007199254740991),
  unique (company_id, id),
  unique (company_id, invoice_id, line_number),
  foreign key (company_id, invoice_id)
    references public.invoices(company_id, id) on delete cascade,
  foreign key (company_id, product_id)
    references public.products(company_id, id) on delete restrict
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null,
  payment_date date not null,
  amount bigint not null check (amount between 1 and 9007199254740991),
  method text not null,
  reference_number text not null default '',
  notes text not null default '',
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, idempotency_key),
  unique (company_id, id, invoice_id),
  foreign key (company_id, invoice_id)
    references public.invoices(company_id, id) on delete restrict
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transaction_number text not null,
  date date not null,
  type public.transaction_type not null,
  category text not null,
  description text not null,
  amount bigint not null check (amount between 1 and 9007199254740991),
  payment_method text not null,
  invoice_id uuid,
  payment_id uuid,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, transaction_number),
  unique (company_id, payment_id),
  check (payment_id is null or invoice_id is not null),
  foreign key (company_id, invoice_id)
    references public.invoices(company_id, id) on delete restrict,
  foreign key (company_id, payment_id, invoice_id)
    references public.payments(company_id, id, invoice_id) on delete restrict
);

create table public.invoice_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  next_value bigint not null default 1 check (next_value between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);

create index customers_company_name_idx on public.customers(company_id, name);
create index products_company_name_idx on public.products(company_id, name);
create index invoices_company_issue_date_idx on public.invoices(company_id, issue_date desc);
create index invoices_company_due_date_idx on public.invoices(company_id, due_date);
create index invoices_company_status_idx on public.invoices(company_id, status);
create index invoice_items_company_invoice_idx on public.invoice_items(company_id, invoice_id, line_number);
create index payments_company_invoice_date_idx on public.payments(company_id, invoice_id, payment_date);
create index transactions_company_date_type_idx on public.transactions(company_id, date, type);
create index transactions_company_invoice_idx on public.transactions(company_id, invoice_id);

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.transactions enable row level security;
alter table public.invoice_sequences enable row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy companies_select_owner on public.companies
  for select to authenticated using (owner_id = (select auth.uid()));
create policy companies_insert_owner on public.companies
  for insert to authenticated with check (owner_id = (select auth.uid()));

create policy company_settings_select_owner on public.company_settings
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy company_settings_insert_owner on public.company_settings
  for insert to authenticated
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy company_settings_update_owner on public.company_settings
  for update to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));

create policy customers_select_owner on public.customers
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy customers_insert_owner on public.customers
  for insert to authenticated
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy customers_update_owner on public.customers
  for update to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy customers_delete_owner on public.customers
  for delete to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));

create policy products_select_owner on public.products
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy products_insert_owner on public.products
  for insert to authenticated
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy products_update_owner on public.products
  for update to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy products_delete_owner on public.products
  for delete to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));

create policy invoices_select_owner on public.invoices
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy invoice_items_select_owner on public.invoice_items
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy payments_select_owner on public.payments
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));

create policy transactions_select_owner on public.transactions
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));
create policy transactions_insert_manual_owner on public.transactions
  for insert to authenticated
  with check (
    payment_id is null and invoice_id is null
    and exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid()))
  );
create policy transactions_update_manual_owner on public.transactions
  for update to authenticated
  using (
    payment_id is null and invoice_id is null
    and exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid()))
  )
  with check (
    payment_id is null and invoice_id is null
    and exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid()))
  );
create policy transactions_delete_manual_owner on public.transactions
  for delete to authenticated
  using (
    payment_id is null and invoice_id is null
    and exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid()))
  );
create policy invoice_sequences_select_owner on public.invoice_sequences
  for select to authenticated
  using (exists (select 1 from public.companies c where c.id = company_id and c.owner_id = (select auth.uid())));

revoke all on public.profiles, public.companies, public.company_settings, public.customers,
  public.products, public.invoices, public.invoice_items, public.payments,
  public.transactions, public.invoice_sequences from public, anon, authenticated;
revoke usage on type public.invoice_type, public.invoice_status, public.transaction_type from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on type public.invoice_type, public.invoice_status, public.transaction_type to authenticated;
grant usage on type public.invoice_type, public.invoice_status, public.transaction_type to service_role;
grant select, insert, update on public.profiles to authenticated;
grant select on public.companies to authenticated;
grant insert (owner_id, invoice_timezone) on public.companies to authenticated;
grant select on public.company_settings to authenticated;
grant insert (company_id, id, company_name, company_address, phone, email, website, bank_info, invoice_prefix, default_tax, payment_terms, theme, updated_at)
  on public.company_settings to authenticated;
grant update (company_name, company_address, phone, email, website, bank_info, invoice_prefix, default_tax, payment_terms, theme, updated_at)
  on public.company_settings to authenticated;
grant select, insert, update, delete on public.customers, public.products to authenticated;
grant select on public.invoices, public.invoice_items, public.payments to authenticated;
grant select on public.transactions to authenticated;
grant insert (company_id, transaction_number, date, type, category, description, amount, payment_method, notes, created_at)
  on public.transactions to authenticated;
grant update (date, type, category, description, amount, payment_method, notes)
  on public.transactions to authenticated;
grant delete on public.transactions to authenticated;
grant select on public.invoice_sequences to authenticated;
commit;
