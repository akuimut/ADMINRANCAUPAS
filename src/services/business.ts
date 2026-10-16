import { db, type Customer, type Invoice, type InvoiceItem, type InvoiceStatus, type InvoiceType, type Payment, type Product, type Transaction, type TransactionType } from '../db/database'
import { addCloudPayment, addCloudTransaction, createCloudInvoice, updateCloudInvoice } from './cloud'

export const today = () => new Date().toISOString().slice(0, 10)

export function invoiceStatus(invoice: Pick<Invoice, 'status' | 'dueDate' | 'balanceDue'> & Partial<Pick<Invoice, 'amountPaid'>>, date = today()): InvoiceStatus {
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return invoice.status
  if (invoice.balanceDue <= 0) return 'paid'
  if (invoice.dueDate && invoice.dueDate < date) return 'overdue'
  return invoice.amountPaid ? 'partial' : 'unpaid'
  return 'unpaid'
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0)
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  await createCloudInvoice({ ...input, type })
}

export async function recordPayment(invoice: Invoice, payment: Omit<Payment, 'id' | 'invoiceId' | 'createdAt'>) {
  if (!invoice.id) throw new Error('Invoice tidak ditemukan.')
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) throw new Error('Nominal pembayaran harus lebih dari nol.')
  if (payment.amount > invoice.balanceDue) throw new Error('Pembayaran melebihi sisa tagihan.')
  await addCloudPayment(invoice, payment)
}

export async function addTransaction(input: Omit<Transaction, 'id' | 'transactionNumber' | 'createdAt'>) {
  await addCloudTransaction(input)
}

export async function updateInvoice(id: number | string, changes: Pick<Invoice, 'type' | 'partyName' | 'partyAddress' | 'partyPhone' | 'issueDate' | 'dueDate' | 'items' | 'subtotal' | 'discount' | 'tax' | 'taxPercent' | 'total' | 'balanceDue' | 'notes' | 'customerId'>) {
  if (typeof id !== 'string') throw new Error('Invoice ini belum memiliki ID cloud yang valid.')
  await updateCloudInvoice(id, { ...changes, amountPaid: 0, status: 'unpaid' })
}

export function csvDownload(filename: string, rows: Array<Record<string, string | number | undefined>>) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const delimiter = ';'
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const content = [`sep=${delimiter}`, headers.map(escape).join(delimiter), ...rows.map((row) => headers.map((header) => escape(row[header])).join(delimiter))].join('\r\n')
  downloadBlob(filename, new Blob(['\ufeff', content], { type: 'text/csv;charset=utf-8' }))
}

export async function exportLegacyLocalBackup() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customers: await db.customers.toArray(), products: await db.products.toArray(), invoices: await db.invoices.toArray(),
    payments: await db.payments.toArray(), transactions: await db.transactions.toArray(), settings: await db.settings.toArray(),
  }
  downloadBlob(`rancaupas-backup-${today()}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
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