import Dexie, { type EntityTable } from 'dexie'

export type InvoiceType = 'sale' | 'purchase'
export type InvoiceStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled'
export type TransactionType = 'income' | 'expense'

export interface Customer {
  id?: number | string
  customerCode: string
  name: string
  companyName: string
  phone: string
  email: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
  isActive: boolean
}

export interface Product {
  id?: number | string
  productCode: string
  name: string
  category: string
  description: string
  unit: string
  sellingPrice: number
  costPrice: number
  stock: number
  createdAt: string
  updatedAt: string
  isActive: boolean
}

export interface InvoiceItem {
  productId?: number | string
  productCode: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discount: number
}

export interface Invoice {
  id?: number | string
  invoiceNumber: string
  type: InvoiceType
  customerId?: number | string
  partyName: string
  partyAddress: string
  partyPhone: string
  issueDate: string
  dueDate: string
  items: InvoiceItem[]
  subtotal: number
  discount: number
  tax: number
  taxPercent: number
  total: number
  amountPaid: number
  balanceDue: number
  status: InvoiceStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id?: number | string
  invoiceId: number | string
  paymentDate: string
  amount: number
  method: string
  referenceNumber: string
  notes: string
  createdAt: string
}

export interface Transaction {
  id?: number | string
  transactionNumber: string
  date: string
  type: TransactionType
  category: string
  description: string
  amount: number
  paymentMethod: string
  invoiceId?: number | string
  notes: string
  createdAt: string
}

export interface CompanySettings {
  id: 'company'
  companyName: string
  companyAddress: string
  phone: string
  email: string
  website: string
  bankInfo: string
  invoicePrefix: string
  invoiceCounter: number
  defaultTax: number
  paymentTerms: string
  theme: 'light' | 'dark'
  updatedAt: string
}

class BeautyDatabase extends Dexie {
  customers!: EntityTable<Customer, 'id'>
  products!: EntityTable<Product, 'id'>
  invoices!: EntityTable<Invoice, 'id'>
  payments!: EntityTable<Payment, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  settings!: EntityTable<CompanySettings, 'id'>

  constructor() {
    super('rancaupas-beauty')
    this.version(1).stores({
      customers: '++id, customerCode, name, isActive, createdAt',
      products: '++id, productCode, name, category, isActive',
      invoices: '++id, &invoiceNumber, type, customerId, issueDate, dueDate, status',
      payments: '++id, invoiceId, paymentDate',
      transactions: '++id, &transactionNumber, date, type, category, invoiceId',
      settings: 'id',
    })
  }
}

export const db = new BeautyDatabase()

export const defaultSettings: CompanySettings = {
  id: 'company',
  companyName: 'RANCAUPAS BEAUTY',
  companyAddress: '',
  phone: '',
  email: '',
  website: '',
  bankInfo: '',
  invoicePrefix: 'RB',
  invoiceCounter: 1,
  defaultTax: 0,
  paymentTerms: '',
  theme: 'light',
  updatedAt: new Date().toISOString(),
}