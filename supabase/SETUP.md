# Supabase Schema Preparation

Status: the web and Android client use the Supabase repository, email authentication, first-workspace provisioning, atomic invoice/payment RPCs, and Realtime subscriptions. Migrations are not applied automatically; check the Supabase migration history and apply only unapplied files in order. Local Dexie data is not imported automatically.

## Migration order

- `migrations/0001_core_schema.sql`: schema, tenant foreign keys, safe money ranges, per-operation RLS, and explicit grants.
- `migrations/0002_atomic_invoice_number.sql`: owner-checked, atomic allocator using a company timezone chosen before use.
- `migrations/0003_atomic_invoice_payment.sql`: idempotent payment RPC that writes payment, invoice balances/status, and its cash transaction in one PostgreSQL transaction.
- `migrations/0004_workspace_and_invoice_writes.sql`: owner-only workspace provisioning, atomic invoice CRUD RPCs, and Realtime publication setup.
- `migrations/0005_zero_balance_invoice_paid.sql`: marks zero-or-negative-balance invoices paid, fixes existing statuses, and enforces the rule on future invoice writes.
- `migrations/0006_invoice_tax_percentage.sql`: stores the entered tax percentage, estimates it for existing invoices, and validates tax amounts in invoice create/edit RPCs.

Apply only after approval, after a staging review, and after independent backups of web and APK data. Do not rerun these `CREATE` migrations as ordinary SQL scripts; they are versioned migrations. There is intentionally no destructive down migration.

## Dexie mapping retained

- Tables/fields for profiles, companies, customers, products/services, invoices, invoice items, payments, transactions, and company settings are retained. The settings compatibility field `id = 'company'` remains; `company_id` is the relational key.
- `invoice_items` normalizes the Dexie `Invoice.items` array. The cloud repository reconstructs the array ordered by `line_number` and preserves product snapshots (`product_code`, description, unit, price, discount).
- Invoice type/status and transaction type enums match the current values. Payment RPC follows the current amount check and status calculation; it does not rewrite the UI formula.
- Payment and its linked transaction are created by one RPC. The transaction uses `payment_id`, and a unique company/payment constraint allows at most one linked cash row. Direct manual cash rows must have both `payment_id` and `invoice_id` null.
- Direct authenticated writes to invoices, invoice items, and payments are withheld. The application uses the invoice RPCs in migration `0004` and `record_invoice_payment` for payment writes.

Invoice tax rates are stored separately from the tax amount in `invoices.tax_percent`. Existing rates are estimates because earlier schema versions retained only the tax amount; new invoices preserve the entered percentage exactly to three decimal places.

## Money serialization

Amounts use PostgreSQL `bigint` for exact integer rupiah, constrained to JavaScript's safe-integer range (`±9007199254740991`; nonnegative for ordinary amounts). This avoids silently storing values that the current TypeScript `number` calculations cannot represent exactly.

At the repository boundary, accept integer values only. For an incoming decimal string, parse with `BigInt`, compare against `Number.MAX_SAFE_INTEGER`, then convert to `number` only if in range and `Number.isSafeInteger` succeeds. For outgoing values, first require `Number.isSafeInteger(value)`, then serialize as a base-10 integer string for the PostgreSQL `bigint` field. Never use `parseFloat` or round a money value to make it fit. Reject and report out-of-range backup rows during dry-run; do not truncate or coerce them. Keep calculations in the current app unchanged.

Quantities use `numeric(18,2)` to preserve the current quantity editor's two decimal places. Timestamps use `timestamptz`; business dates use `date`.

## Security and allowed access

All tenant tables have RLS. Policies identify the caller by `auth.uid()` and allow company-scoped rows only when that user owns the company. Composite foreign keys include `company_id`, preventing cross-company links even if an ID is supplied manually.

| Data | Authenticated direct access |
|---|---|
| Profile | Select/insert/update own row; no delete |
| Company | Select/insert own row; no direct update/delete. Set `invoice_timezone` at provisioning |
| Company settings | Select/insert/update own row on allowed columns; `invoice_counter` is read-only; no delete |
| Customers and products | Owner-scoped CRUD; referenced deletion remains blocked by FKs |
| Invoices and invoice items | Select only; create/edit/delete are available only through owner-checked RPCs |
| Payments | Select only; writes only through `record_invoice_payment` |
| Transactions | Select owner rows; direct insert/update/delete only for manual rows with no invoice/payment link |
| Invoice sequences | Select only; no direct insert/update/delete |

Table privileges are explicitly revoked from `PUBLIC`, `anon`, and `authenticated` before the intended grants are added, so broader project default table grants do not silently remain for these roles. Enum usage is granted only to `authenticated` and the trusted `service_role`. The service-role key must never be shipped to GitHub Pages or the APK.

Protected RPCs use `SECURITY DEFINER` because authenticated clients have no direct table write grants for protected operations. Each function has `search_path = ''`, schema-qualified object references, a caller-to-company ownership check using `auth.uid()`, and `EXECUTE` revoked from `PUBLIC`, `anon`, and `authenticated` before granting only `authenticated`. The function owner is trusted; these functions must remain narrowly scoped and must not be expanded into generic SQL/table access.

## Invoice number and timezone

The number format remains `INV/{prefix}/{year}/{counter padded to at least four digits}` for sales and `BILL/...` for purchases. One sequence is shared across both invoice types, like the current single Dexie `invoiceCounter`. The unique `(company_id, invoice_number)` constraint remains.

The current app's invoice year comes from the device's local `new Date().getFullYear()`. PostgreSQL `current_date` may use a different timezone, so the RPC does not use it. `companies.invoice_timezone` has no default; the allocator fails until an owner-approved IANA timezone is assigned during company provisioning. It is not directly editable after company creation. Confirm the business timezone first; do not assume `Asia/Jakarta` or any other zone. After confirmation, all devices use that same company's year.

The RPC locks/updates the company's sequence row transactionally and mirrors its next value into `company_settings.invoice_counter`. A failed later invoice insert may leave a number gap. The client must not write either counter directly. Invoice create/edit/delete now run through owner-checked database RPCs.

## Payment behavior and unresolved decisions

The payment RPC requires a non-null idempotency UUID. The app generates one per payment action, persists it in local storage while pending, and reuses the same key and payload after a timeout/retry. Reuse of the key with different payment data is rejected. Advisory transaction locking serializes concurrent retries of the same key; the unique `(company_id, idempotency_key)` constraint is a second guard.

The RPC rejects nonpositive amounts, amounts above the stored `balance_due`, and cancelled invoices. This matches current validation/UI. The current UI does not block a draft invoice with a positive balance; the RPC therefore preserves draft status if paid. The RPC uses the UTC calendar date internally, matching the app's existing `today()` implementation based on `toISOString()`; the caller cannot supply an arbitrary status date. The RPC maps sale payment to income and purchase payment to expense, using the existing category/description labels.

An invoice with `balanceDue <= 0` is paid, except drafts and cancelled invoices, which retain their explicit status. Exact settlement therefore becomes paid. Migration `0005` backfills existing invoice statuses and a trigger enforces the same rule on future writes. Payment status dates use the UTC calendar date, matching the app's `today()` implementation based on `toISOString()`.

The cash transaction number retains the `TRX-` prefix and timestamp component, with a short UUID suffix to avoid collisions when web/APK payments occur in the same millisecond. Confirm whether the displayed transaction-number format is also a business invariant before application rollout.

Still requiring owner confirmation:

- The IANA timezone used for invoice year generation.
- Whether a draft invoice should remain payable.
- Whether counter sequence remains shared across sale/purchase invoices and never resets annually.
- Whether transaction numbers may include a UUID suffix.
- Payment correction policy. Current UI has no payment edit/delete; this schema makes payment history RPC-only and linked cash rows non-editable directly.
- Company cardinality. The application supports one company per owner and the provisioning RPC enforces it. Adding a company switcher requires a separate product and authorization review.

## Staged SQL test scenarios (not executed)

Use only a disposable staging project with fixture UUIDs and two Auth users/companies. These are test templates, not commands run during preparation. Each expected-error case should run in its own transaction/session and be rolled back.

Cross-company reads and writes, as owner A:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<owner-a-uuid>', true);
select count(*) from public.invoices where company_id = '<company-b-uuid>'::uuid;
-- Expected: 0 rows visible.
update public.company_settings set company_name = 'unauthorized'
where company_id = '<company-b-uuid>'::uuid;
-- Expected: 0 rows affected; cross-company insert should fail RLS.
rollback;
```

Counter protection, as owner A: attempt `UPDATE company_settings SET invoice_counter = ...` and `INSERT/UPDATE/DELETE invoice_sequences`; each must fail with insufficient privilege. Then call `next_invoice_number` for company B; it must fail authorization.

Concurrent invoice numbering: from two authenticated sessions for the same company, call `next_invoice_number(company_id, 'sale')` concurrently and repeat with `'purchase'`. Results must be distinct, preserve format, and advance one shared sequence. Also test that the function refuses to allocate before a valid company timezone is configured.

Payment idempotency: in one test transaction, call `record_invoice_payment` twice with the same company, invoice, key, and payload. Both calls must return the same payment/transaction IDs, with one payment row and one linked transaction. Reuse that key with a different amount or invoice; it must fail. Roll back the test transaction.

Payment/cash integrity: as authenticated owner, direct payment insert/update/delete must fail. Direct linked transaction insert/update/delete must fail. A payment RPC call must create exactly one linked transaction with equal amount, expected income/expense type, same invoice/company/date/method, and matching category/description. A query joining payments to linked transactions should return zero mismatches. Roll back all fixtures.

Cross-company foreign keys: using a privileged fixture setup only in disposable staging, attempt same-company records that reference another company's customer, product, invoice, or payment. Each composite FK must reject the link. Do not use a service-role key in the application.

## Migration and rollback checklist

- [ ] Approve the business questions above and choose the company timezone.
- [ ] Create staging Auth users/companies; verify per-operation grants and RLS with two owners.
- [ ] Run the documented concurrency, idempotency, mismatch, and composite-FK tests only after explicit migration approval.
- [ ] Back up web and APK separately. Dry-run import, report duplicate invoice/transaction numbers, orphan IDs, and out-of-safe-range money before importing.
- [ ] Seed the invoice sequence above every imported counter/suffix; retain original invoice numbers.
- [ ] Reconcile payment history, `amountPaid`, and `balanceDue`; compare existing dashboard/report aggregates without changing formulas.
- [ ] Keep immutable local backups. If cutover fails, stop cloud writes and restore from the preserved snapshot; do not drop tables or reset counters after cloud writes begin.
- [ ] Apply all six migrations to a disposable staging project and verify RPC signatures, row-level security, tax percentage reconciliation, zero-balance status, and Realtime events before production.
- [ ] Configure the same project URL and publishable/anon key for the web build and Android build. Never embed a service-role key.
- [ ] Back up web and APK separately; local data is not imported automatically by the cloud client.
