import { defaultSettings, type CompanySettings, type Customer, type Invoice, type InvoiceItem, type Product, type Transaction } from '../db/database'
import { requireSupabase } from '../lib/supabase'

type Row = Record<string, unknown>
type Workspace = {
  customers: Customer[]
  products: Product[]
  invoices: Invoice[]
  transactions: Transaction[]
  settings: CompanySettings
}

let companyIdCache: string | null = null

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function safeNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('Data nominal dari Supabase berada di luar rentang angka aman.')
  return number
}

function moneyValue(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error('Nominal harus berupa bilangan bulat dalam rentang aman.')
  return String(value)
}

function mapCustomer(row: Row): Customer {
  return {
    id: String(row.id), customerCode: String(row.customer_code), name: String(row.name), companyName: String(row.company_name),
    phone: String(row.phone), email: String(row.email), address: String(row.address), notes: String(row.notes),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), isActive: Boolean(row.is_active),
  }
}

function mapProduct(row: Row): Product {
  return {
    id: String(row.id), productCode: String(row.product_code), name: String(row.name), category: String(row.category),
    description: String(row.description), unit: String(row.unit), sellingPrice: safeNumber(row.selling_price),
    costPrice: safeNumber(row.cost_price), stock: Number(row.stock), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), isActive: Boolean(row.is_active),
  }
}

function mapInvoiceItem(row: Row): InvoiceItem {
  return {
    productId: row.product_id ? String(row.product_id) : undefined, productCode: String(row.product_code),
    description: String(row.description), quantity: Number(row.quantity), unit: String(row.unit),
    unitPrice: safeNumber(row.unit_price), discount: safeNumber(row.discount),
  }
}

function mapInvoice(row: Row): Invoice {
  const items = Array.isArray(row.invoice_items) ? row.invoice_items as Row[] : []
  const mappedItems = items.sort((a, b) => Number(a.line_number) - Number(b.line_number)).map(mapInvoiceItem)
  const subtotal = safeNumber(row.subtotal)
  const discount = safeNumber(row.discount)
  const tax = safeNumber(row.tax)
  const taxable = Math.max(0, subtotal - discount - mappedItems.reduce((sum, item) => sum + item.discount, 0))
  const storedTaxPercent = Number(row.tax_percent ?? 0)
  const estimatedTaxPercent = taxable > 0 ? Math.round(tax / taxable * 1000) / 10 : 0
  return {
    id: String(row.id), invoiceNumber: String(row.invoice_number), type: row.type as Invoice['type'],
    customerId: row.customer_id ? String(row.customer_id) : undefined, partyName: String(row.party_name),
    partyAddress: String(row.party_address), partyPhone: String(row.party_phone), issueDate: String(row.issue_date),
    dueDate: String(row.due_date ?? ''), items: mappedItems,
    subtotal, discount, tax, taxPercent: storedTaxPercent > 0 || tax === 0 ? storedTaxPercent : estimatedTaxPercent,
    total: safeNumber(row.total), amountPaid: safeNumber(row.amount_paid), balanceDue: safeNumber(row.balance_due),
    status: row.status as Invoice['status'], notes: String(row.notes), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function mapTransaction(row: Row): Transaction {
  return {
    id: String(row.id), transactionNumber: String(row.transaction_number), date: String(row.date),
    type: row.type as Transaction['type'], category: String(row.category), description: String(row.description),
    amount: safeNumber(row.amount), paymentMethod: String(row.payment_method),
    invoiceId: row.invoice_id ? String(row.invoice_id) : undefined, notes: String(row.notes), createdAt: String(row.created_at),
  }
}

function mapSettings(row?: Row | null): CompanySettings {
  if (!row) return { ...defaultSettings }
  return {
    id: 'company', companyName: String(row.company_name), companyAddress: String(row.company_address), phone: String(row.phone),
    email: String(row.email), website: String(row.website), bankInfo: String(row.bank_info), invoicePrefix: String(row.invoice_prefix),
    invoiceCounter: safeNumber(row.invoice_counter), defaultTax: Number(row.default_tax), paymentTerms: String(row.payment_terms),
    theme: row.theme === 'dark' ? 'dark' : 'light', updatedAt: String(row.updated_at),
  }
}

export async function getOwnedCompanyId(): Promise<string | null> {
  if (companyIdCache) return companyIdCache
  const client = requireSupabase()
  const { data: { user }, error: userError } = await client.auth.getUser()
  fail(userError)
  if (!user) return null
  const { data, error } = await client.from('companies').select('id').eq('owner_id', user.id).limit(2)
  fail(error)
  if (!data?.length) return null
  if (data.length > 1) throw new Error('Akun ini memiliki lebih dari satu perusahaan. Hubungi administrator untuk menentukan workspace aktif.')
  companyIdCache = String(data[0].id)
  return companyIdCache
}

async function companyId() {
  const id = await getOwnedCompanyId()
  if (!id) throw new Error('Workspace perusahaan belum dibuat.')
  return id
}

export function resetCloudWorkspaceCache() {
  companyIdCache = null
}

export async function createCloudWorkspace(settings: CompanySettings, timezone: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_company_workspace', {
    p_invoice_timezone: timezone,
    p_company_name: settings.companyName,
    p_company_address: settings.companyAddress,
    p_phone: settings.phone,
    p_email: settings.email,
    p_website: settings.website,
    p_bank_info: settings.bankInfo,
    p_invoice_prefix: settings.invoicePrefix,
    p_default_tax: settings.defaultTax,
    p_payment_terms: settings.paymentTerms,
    p_theme: settings.theme,
  })
  fail(error)
  companyIdCache = String(data)
}

export async function loadCloudWorkspace(): Promise<Workspace> {
  const client = requireSupabase()
  const company = await companyId()
  const [customersResult, productsResult, invoicesResult, transactionsResult, settingsResult] = await Promise.all([
    client.from('customers').select('*').eq('company_id', company).order('name'),
    client.from('products').select('*').eq('company_id', company).order('name'),
    client.from('invoices').select('*, invoice_items(*)').eq('company_id', company).order('issue_date', { ascending: false }),
    client.from('transactions').select('*').eq('company_id', company).order('date', { ascending: false }),
    client.from('company_settings').select('*').eq('company_id', company).maybeSingle(),
  ])
  fail(customersResult.error); fail(productsResult.error); fail(invoicesResult.error); fail(transactionsResult.error); fail(settingsResult.error)
  return {
    customers: (customersResult.data ?? []).map((row) => mapCustomer(row as Row)),
    products: (productsResult.data ?? []).map((row) => mapProduct(row as Row)),
    invoices: (invoicesResult.data ?? []).map((row) => mapInvoice(row as Row)),
    transactions: (transactionsResult.data ?? []).map((row) => mapTransaction(row as Row)),
    settings: mapSettings(settingsResult.data as Row | null | undefined),
  }
}

export async function getCloudInvoice(id: string): Promise<Invoice> {
  const client = requireSupabase(); const company = await companyId()
  const { data, error } = await client.from('invoices').select('*, invoice_items(*)').eq('company_id', company).eq('id', id).single()
  fail(error)
  return mapInvoice(data as Row)
}

function customerRow(input: Customer) {
  return {
    customer_code: input.customerCode, name: input.name, company_name: input.companyName, phone: input.phone,
    email: input.email, address: input.address, notes: input.notes, is_active: input.isActive,
    updated_at: input.updatedAt,
  }
}

export async function saveCloudCustomer(input: Customer) {
  const client = requireSupabase(); const company = await companyId(); const values = customerRow(input)
  const result = input.id
    ? await client.from('customers').update(values).eq('company_id', company).eq('id', input.id)
    : await client.from('customers').insert({ ...values, company_id: company, created_at: input.createdAt })
  fail(result.error)
}

function productRow(input: Product) {
  return {
    product_code: input.productCode, name: input.name, category: input.category, description: input.description,
    unit: input.unit, selling_price: moneyValue(input.sellingPrice), cost_price: moneyValue(input.costPrice), stock: input.stock,
    is_active: input.isActive, updated_at: input.updatedAt,
  }
}

export async function saveCloudProduct(input: Product) {
  const client = requireSupabase(); const company = await companyId(); const values = productRow(input)
  const result = input.id
    ? await client.from('products').update(values).eq('company_id', company).eq('id', input.id)
    : await client.from('products').insert({ ...values, company_id: company, created_at: input.createdAt })
  fail(result.error)
}

export async function setCloudProductActive(id: number | string, isActive: boolean) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.from('products').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('company_id', company).eq('id', id)
  fail(error)
}

export async function deleteCloudCustomer(id: number | string) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.from('customers').delete().eq('company_id', company).eq('id', id)
  fail(error)
}

export async function saveCloudSettings(input: CompanySettings) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.from('company_settings').update({
    company_name: input.companyName, company_address: input.companyAddress, phone: input.phone, email: input.email,
    website: input.website, bank_info: input.bankInfo, invoice_prefix: input.invoicePrefix, default_tax: input.defaultTax,
    payment_terms: input.paymentTerms, theme: input.theme, updated_at: input.updatedAt,
  }).eq('company_id', company)
  fail(error)
}

export async function addCloudTransaction(input: Omit<Transaction, 'id' | 'transactionNumber' | 'createdAt'>) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.from('transactions').insert({
    company_id: company, transaction_number: `TRX-${crypto.randomUUID()}`, date: input.date, type: input.type,
    category: input.category, description: input.description, amount: moneyValue(input.amount), payment_method: input.paymentMethod,
    notes: input.notes, created_at: new Date().toISOString(),
  })
  fail(error)
}

function invoicePayload(input: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'updatedAt'>) {
  return {
    type: input.type, customer_id: input.customerId ?? null, party_name: input.partyName,
    party_address: input.partyAddress, party_phone: input.partyPhone, issue_date: input.issueDate,
    due_date: input.dueDate || null, subtotal: moneyValue(input.subtotal), discount: moneyValue(input.discount), tax: moneyValue(input.tax),
    tax_percent: input.taxPercent ?? 0, total: moneyValue(input.total), notes: input.notes, items: input.items.map((item) => ({
      product_id: item.productId ?? null, product_code: item.productCode, description: item.description,
      quantity: item.quantity, unit: item.unit, unit_price: moneyValue(item.unitPrice), discount: moneyValue(item.discount),
    })),
  }
}

export async function createCloudInvoice(input: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'updatedAt'>) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.rpc('create_company_invoice', { p_company_id: company, p_invoice: invoicePayload(input) })
  fail(error)
}

export async function updateCloudInvoice(id: string, input: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'updatedAt'>) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.rpc('update_company_invoice', { p_company_id: company, p_invoice_id: id, p_invoice: invoicePayload(input) })
  fail(error)
}

export async function deleteCloudInvoice(id: string) {
  const client = requireSupabase(); const company = await companyId()
  const { error } = await client.rpc('delete_company_invoice', { p_company_id: company, p_invoice_id: id })
  fail(error)
}

export async function addCloudPayment(invoice: Invoice, input: { paymentDate: string; amount: number; method: string; referenceNumber: string; notes: string }) {
  const client = requireSupabase(); const company = await companyId()
  const cacheKey = `rancaupas:payment:${invoice.id}`
  const payload = JSON.stringify(input)
  const pending = localStorage.getItem(cacheKey)
  const saved = pending ? JSON.parse(pending) as { payload: string; key: string } : null
  const key = saved?.payload === payload ? saved.key : crypto.randomUUID()
  localStorage.setItem(cacheKey, JSON.stringify({ payload, key }))
  const { error } = await client.rpc('record_invoice_payment', {
    p_company_id: company, p_invoice_id: invoice.id, p_idempotency_key: key,
    p_payment_date: input.paymentDate, p_amount: moneyValue(input.amount), p_method: input.method,
    p_reference_number: input.referenceNumber, p_notes: input.notes,
  })
  fail(error)
  localStorage.removeItem(cacheKey)
}

export async function exportCloudBackup() {
  const client = requireSupabase(); const company = await companyId()
  const data = await loadCloudWorkspace()
  const { data: paymentRows, error } = await client.from('payments').select('*').eq('company_id', company).order('payment_date')
  fail(error)
  return {
    version: 1, exportedAt: new Date().toISOString(), customers: data.customers, products: data.products,
    invoices: data.invoices, payments: paymentRows ?? [], transactions: data.transactions, settings: [data.settings],
  }
}