import { db, defaultSettings, type Customer, type Invoice, type InvoiceItem, type InvoiceStatus, type InvoiceType, type Payment, type Product, type Transaction, type TransactionType } from '../db/database'

export const today = () => new Date().toISOString().slice(0, 10)

export function invoiceStatus(invoice: Pick<Invoice, 'status' | 'dueDate' | 'balanceDue'> & Partial<Pick<Invoice, 'amountPaid'>>, date = today()): InvoiceStatus {
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return invoice.status
  if (invoice.balanceDue < 0) return 'paid'
  if (invoice.dueDate && invoice.dueDate < date) return 'overdue'
  return invoice.amountPaid ? 'partial' : 'unpaid'
  return 'unpaid'
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0)
}

export function formatDate(value: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

export function totals(items: InvoiceItem[], discount: number, taxPercent: number) {
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice), 0)
  const itemDiscount = items.reduce((sum, item) => sum + Math.round(item.discount || 0), 0)
  const taxable = Math.max(0, subtotal - itemDiscount - discount)
  const tax = Math.round(taxable * taxPercent / 100)
  return { subtotal, tax, total: Math.max(0, taxable + tax) }
}

export async function saveInvoice(input: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'updatedAt'>, type: InvoiceType) {
  return db.transaction('rw', db.settings, db.invoices, async () => {
    const settings = { ...defaultSettings, ...(await db.settings.get('company')) }
    const number = `${type === 'sale' ? 'INV' : 'BILL'}/${settings.invoicePrefix}/${new Date().getFullYear()}/${String(settings.invoiceCounter).padStart(4, '0')}`
    const now = new Date().toISOString()
    const invoice: Invoice = { ...input, type, invoiceNumber: number, createdAt: now, updatedAt: now }
    await db.invoices.add(invoice)
    await db.settings.put({ ...settings, invoiceCounter: settings.invoiceCounter + 1, updatedAt: now })
    return invoice
  })
}

export async function recordPayment(invoice: Invoice, payment: Omit<Payment, 'id' | 'invoiceId' | 'createdAt'>) {
  if (!invoice.id) throw new Error('Invoice tidak ditemukan.')
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) throw new Error('Nominal pembayaran harus lebih dari nol.')
  if (payment.amount > invoice.balanceDue) throw new Error('Pembayaran melebihi sisa tagihan.')
  return db.transaction('rw', db.invoices, db.payments, db.transactions, async () => {
    const current = await db.invoices.get(invoice.id!)
    if (!current || payment.amount > current.balanceDue) throw new Error('Sisa tagihan berubah. Muat ulang invoice.')
    const now = new Date().toISOString()
    const nextPaid = current.amountPaid + payment.amount
    const updated = { ...current, amountPaid: nextPaid, balanceDue: current.total - nextPaid, updatedAt: now }
    updated.status = invoiceStatus(updated)
    await db.payments.add({ ...payment, invoiceId: current.id!, createdAt: now })
    await db.invoices.put(updated)
    await db.transactions.add({
      transactionNumber: `TRX-${Date.now()}`, date: payment.paymentDate, type: current.type === 'sale' ? 'income' : 'expense',
      category: current.type === 'sale' ? 'Pembayaran invoice' : 'Pembayaran pemasok', description: `Pembayaran ${current.invoiceNumber}`,
      amount: payment.amount, paymentMethod: payment.method, invoiceId: current.id, notes: payment.notes, createdAt: now,
    })
    return updated
  })
}

export async function addTransaction(input: Omit<Transaction, 'id' | 'transactionNumber' | 'createdAt'>) {
  await db.transactions.add({ ...input, transactionNumber: `TRX-${Date.now()}`, createdAt: new Date().toISOString() })
}

export async function updateInvoice(id: number, changes: Pick<Invoice, 'partyName' | 'partyAddress' | 'partyPhone' | 'issueDate' | 'dueDate' | 'items' | 'subtotal' | 'discount' | 'tax' | 'total' | 'balanceDue' | 'notes' | 'customerId'>) {
  const invoice = await db.invoices.get(id)
  if (!invoice) throw new Error('Invoice tidak ditemukan.')
  if (changes.total < invoice.amountPaid) throw new Error('Total invoice tidak boleh lebih kecil dari pembayaran yang sudah diterima.')
  const updated = { ...invoice, ...changes, balanceDue: changes.total - invoice.amountPaid, updatedAt: new Date().toISOString() }
  updated.status = invoiceStatus(updated)
  await db.invoices.put(updated)
}

export function csvDownload(filename: string, rows: Array<Record<string, string | number | undefined>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const content = [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row[header])).join(','))].join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function exportBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customers: await db.customers.toArray(), products: await db.products.toArray(), invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(), transactions: await db.transactions.toArray(), settings: await db.settings.toArray(),
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  link.download = `rancaupas-backup-${today()}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function restoreBackup(file: File) {
  const raw: unknown = JSON.parse(await file.text())
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1) throw new Error('Format backup tidak valid atau versinya tidak didukung.')
  const backup = raw as Record<string, unknown>
  const tables = ['customers', 'products', 'invoices', 'payments', 'transactions', 'settings'] as const
  for (const table of tables) if (!Array.isArray(backup[table])) throw new Error(`Data ${table} tidak ditemukan pada backup.`)
  await db.transaction('rw', [db.customers, db.products, db.invoices, db.payments, db.transactions, db.settings], async () => {
    for (const table of tables) await db.table(table).clear()
    for (const table of tables) await db.table(table).bulkPut(backup[table] as object[])
  })
}

export function customerDraft(name: string, code: string): Customer {
  const now = new Date().toISOString()
  return { customerCode: code, name, companyName: '', phone: '', email: '', address: '', notes: '', createdAt: now, updatedAt: now, isActive: true }
}

export function productDraft(name: string, code: string, price: number): Product {
  const now = new Date().toISOString()
  return { productCode: code, name, category: 'Umum', description: '', unit: 'pcs', sellingPrice: price, costPrice: 0, stock: 0, createdAt: now, updatedAt: now, isActive: true }
}

export type { TransactionType }