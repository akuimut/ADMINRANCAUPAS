import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowDownLeft, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Boxes, CalendarDays, Check, CircleDollarSign, ClipboardList, Download, FileDown, FileText, LayoutDashboard, Menu, Moon, MoreHorizontal, Package, Plus, Search, Settings2, ShieldCheck, ShoppingBag, Sun, Trash2, TrendingUp, Users, Wallet, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { jsPDF as JsPdf } from 'jspdf'
import { db, defaultSettings, type CompanySettings, type Customer, type Invoice, type InvoiceItem, type Product, type Transaction } from './db/database'
import { addTransaction, csvDownload, customerDraft, exportBackup, formatDate, formatMoney, invoiceStatus, productDraft, recordPayment, restoreBackup, saveInvoice, today, totals, updateInvoice } from './services/business'
import logoUrl from '../Stylized Deer Mountain Emblem.png'
import './app-layout.css'

type Page = 'Dashboard' | 'Invoice' | 'Data Pelanggan' | 'Data Produk dan Jasa' | 'Transaksi' | 'Pemasukan' | 'Pengeluaran' | 'Rekap Data' | 'Laporan' | 'Pengaturan'
type Toast = { message: string; kind: 'success' | 'error' } | null

const navigation: Array<{ label: Page; icon: typeof LayoutDashboard; group: string }> = [
  { label: 'Dashboard', icon: LayoutDashboard, group: 'WORKSPACE' }, { label: 'Invoice', icon: FileText, group: 'WORKSPACE' },
  { label: 'Data Pelanggan', icon: Users, group: 'DATA MASTER' }, { label: 'Data Produk dan Jasa', icon: Package, group: 'DATA MASTER' },
  { label: 'Transaksi', icon: Activity, group: 'KEUANGAN' }, { label: 'Pemasukan', icon: ArrowDownLeft, group: 'KEUANGAN' }, { label: 'Pengeluaran', icon: ArrowUpRight, group: 'KEUANGAN' },
  { label: 'Rekap Data', icon: ClipboardList, group: 'ANALISIS' }, { label: 'Laporan', icon: BarChart3, group: 'ANALISIS' }, { label: 'Pengaturan', icon: Settings2, group: 'LAINNYA' },
]
const statusText: Record<string, string> = { draft: 'Draft', unpaid: 'Belum dibayar', partial: 'Dibayar sebagian', paid: 'Lunas', overdue: 'Jatuh tempo', cancelled: 'Dibatalkan' }
const longDate = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function AppShell() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<Toast>(null)
  const [modal, setModal] = useState<'invoice' | 'customer' | 'product' | 'transaction' | 'payment' | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [range, setRange] = useState('month')

  async function refresh() {
    const [customerRows, productRows, invoiceRows, transactionRows, company] = await Promise.all([db.customers.toArray(), db.products.toArray(), db.invoices.toArray(), db.transactions.toArray(), db.settings.get('company')])
    setCustomers(customerRows); setProducts(productRows); setInvoices(invoiceRows.sort((a, b) => b.issueDate.localeCompare(a.issueDate)))
    setTransactions(transactionRows.sort((a, b) => b.date.localeCompare(a.date))); setSettings(company ?? defaultSettings)
  }
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [customerRows, productRows, invoiceRows, transactionRows, company] = await Promise.all([db.customers.toArray(), db.products.toArray(), db.invoices.toArray(), db.transactions.toArray(), db.settings.get('company')])
        if (!active) return
        setCustomers(customerRows); setProducts(productRows); setInvoices(invoiceRows.sort((a, b) => b.issueDate.localeCompare(a.issueDate)))
        setTransactions(transactionRows.sort((a, b) => b.date.localeCompare(a.date))); setSettings(company ?? defaultSettings)
      } catch { if (active) setToast({ message: 'Database lokal tidak dapat dibuka.', kind: 'error' }) }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(timer) }, [toast])
  function notify(message: string, kind: 'success' | 'error' = 'success') { setToast({ message, kind }) }
  async function act(action: () => Promise<unknown>, message: string) {
    try { await action(); await refresh(); notify(message) } catch (error) { notify(error instanceof Error ? error.message : 'Terjadi kesalahan saat menyimpan data.', 'error') }
  }

  const filteredInvoices = useMemo(() => invoices.filter((invoice) => {
    const matchesSearch = `${invoice.invoiceNumber} ${invoice.partyName}`.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'all' || invoiceStatus(invoice) === statusFilter
    return matchesSearch && matchesStatus && (!fromDate || invoice.issueDate >= fromDate) && (!toDate || invoice.issueDate <= toDate)
  }), [invoices, search, statusFilter, fromDate, toDate])
  const period = useMemo(() => {
    const now = new Date()
    if (range === 'all') return { from: '', to: '' }
    if (range === 'year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today() }
  }, [range])
  const periodTransactions = transactions.filter((item) => (!period.from || item.date >= period.from) && (!period.to || item.date <= period.to))
  const income = periodTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
  const expense = periodTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const salesInvoices = invoices.filter((item) => item.type === 'sale' && item.status !== 'cancelled' && (!period.from || item.issueDate >= period.from) && (!period.to || item.issueDate <= period.to))
  const turnover = salesInvoices.reduce((sum, item) => sum + item.total, 0)
  const receivable = invoices.filter((item) => item.type === 'sale').reduce((sum, item) => sum + Math.max(0, item.balanceDue), 0)
  const payable = invoices.filter((item) => item.type === 'purchase').reduce((sum, item) => sum + Math.max(0, item.balanceDue), 0)
  const monthlyData = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (5 - index))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const month = transactions.filter((item) => item.date.startsWith(key))
    return { month: new Intl.DateTimeFormat('id-ID', { month: 'short' }).format(date), income: month.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0), expense: month.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0) }
  })

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '').trim()
    if (!name) return notify('Nama pelanggan wajib diisi.', 'error')
    const now = new Date().toISOString()
    const fields = { name, companyName: String(form.get('companyName') ?? ''), phone: String(form.get('phone') ?? ''), email: String(form.get('email') ?? ''), address: String(form.get('address') ?? ''), notes: String(form.get('notes') ?? ''), updatedAt: now }
    if (editingCustomer?.id) await act(() => db.customers.update(editingCustomer.id!, fields), 'Pelanggan diperbarui.')
    else await act(() => db.customers.add({ ...customerDraft(name, `CUS-${Date.now().toString().slice(-6)}`), ...fields, createdAt: now }), 'Pelanggan tersimpan.')
    setModal(null); setEditingCustomer(null)
  }
  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get('name') ?? '').trim(); const price = Number(form.get('price'))
    const costPrice = Number(form.get('costPrice') || 0); const stock = Number(form.get('stock') || 0)
    if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(costPrice) || costPrice < 0 || !Number.isFinite(stock) || stock < 0) return notify('Nama, harga, modal, atau stok tidak valid.', 'error')
    const fields = { name, sellingPrice: price, costPrice, stock, category: String(form.get('category') || 'Umum'), unit: String(form.get('unit') || 'pcs'), description: String(form.get('description') || ''), updatedAt: new Date().toISOString() }
    if (editingProduct?.id) await act(() => db.products.update(editingProduct.id!, fields), 'Produk diperbarui.')
    else await act(() => db.products.add({ ...productDraft(name, `PRD-${Date.now().toString().slice(-6)}`, price), ...fields }), 'Produk tersimpan.')
    setModal(null); setEditingProduct(null)
  }
  async function saveManualTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const amount = Number(form.get('amount'))
    if (!Number.isSafeInteger(amount) || amount <= 0) return notify('Nominal harus berupa angka positif.', 'error')
    await act(() => addTransaction({ date: String(form.get('date')), type: String(form.get('type')) as 'income' | 'expense', category: String(form.get('category')), description: String(form.get('description')).trim(), amount, paymentMethod: String(form.get('method')), notes: String(form.get('notes') ?? '') }), 'Transaksi tersimpan.'); setModal(null)
  }
  function openInvoice(invoice?: Invoice) { setEditingInvoice(invoice ?? null); setModal('invoice') }
  async function submitInvoice(event: FormEvent<HTMLFormElement>, items: InvoiceItem[]) {
    event.preventDefault()
    if (!items.length || items.some((item) => !item.description.trim() || item.quantity <= 0 || item.unitPrice < 0 || item.discount < 0)) return notify('Item memerlukan deskripsi, kuantitas, dan harga yang valid.', 'error')
    const form = new FormData(event.currentTarget); const type = String(form.get('type') ?? 'sale') as 'sale' | 'purchase'
    const customerId = form.get('customerId') ? Number(form.get('customerId')) : undefined; const customer = customers.find((item) => item.id === customerId)
    const partyName = String(form.get('partyName') ?? customer?.name ?? '').trim()
    if (!partyName) return notify('Nama pelanggan atau pemasok wajib diisi.', 'error')
    const discount = parseMoneyInput(String(form.get('discount') || '')); const taxPercent = Number(form.get('tax') || 0)
    if (discount < 0 || taxPercent < 0 || taxPercent > 100) return notify('Diskon atau pajak tidak valid.', 'error')
    const calculated = totals(items, discount, taxPercent); const issueDate = String(form.get('issueDate') || today()); const dueDate = String(form.get('dueDate') || '')
    if (dueDate && dueDate < issueDate) return notify('Tanggal jatuh tempo tidak boleh sebelum tanggal invoice.', 'error')
    const input = { type, customerId, partyName, partyAddress: String(form.get('partyAddress') || customer?.address || ''), partyPhone: String(form.get('partyPhone') || customer?.phone || ''), issueDate, dueDate, items, subtotal: calculated.subtotal, discount, tax: calculated.tax, total: calculated.total, amountPaid: 0, balanceDue: calculated.total, status: 'unpaid' as const, notes: String(form.get('notes') || '') }
    try {
      if (editingInvoice?.id) await updateInvoice(editingInvoice.id, input)
      else await saveInvoice(input, type)
      await refresh(); notify(editingInvoice ? 'Invoice diperbarui.' : 'Invoice berhasil dibuat.'); setModal(null); setEditingInvoice(null)
    } catch (error) { notify(error instanceof Error ? error.message : 'Invoice gagal disimpan.', 'error') }
  }
  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paymentInvoice) return
    const form = new FormData(event.currentTarget); const amount = Number(form.get('amount'))
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > paymentInvoice.balanceDue) return notify('Nominal harus positif dan tidak melebihi sisa tagihan.', 'error')
    await act(() => recordPayment(paymentInvoice, { paymentDate: String(form.get('date')), amount, method: String(form.get('method')), referenceNumber: String(form.get('reference') ?? ''), notes: String(form.get('notes') ?? '') }), 'Pembayaran tercatat.')
    setModal(null); setPaymentInvoice(null)
  }
  async function removeInvoice(invoice: Invoice) {
    if (!invoice.id || !window.confirm(`Hapus invoice ${invoice.invoiceNumber}?`)) return
    if (invoice.amountPaid > 0) return notify('Invoice dengan pembayaran tercatat tidak dapat dihapus.', 'error')
    await act(() => db.invoices.delete(invoice.id!), 'Invoice dihapus.')
  }
  async function toggleCustomer(customer: Customer) {
    if (!customer.id) return
    const used = invoices.some((invoice) => invoice.customerId === customer.id)
    if (!window.confirm(used ? 'Data ini digunakan invoice. Ubah status aktif tanpa menghapus riwayat?' : `Hapus pelanggan ${customer.name}?`)) return
    await act(() => used ? db.customers.update(customer.id!, { isActive: !customer.isActive, updatedAt: new Date().toISOString() }) : db.customers.delete(customer.id!), used ? 'Status pelanggan diperbarui.' : 'Pelanggan dihapus.')
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    const next = { ...settings, companyName: String(form.get('companyName')).trim() || 'RANCAUPAS BEAUTY', companyAddress: String(form.get('address')), phone: String(form.get('phone')), email: String(form.get('email')), bankInfo: String(form.get('bankInfo')), invoicePrefix: String(form.get('prefix')).trim().toUpperCase() || 'RB', defaultTax: Number(form.get('tax') || 0), paymentTerms: String(form.get('terms')), updatedAt: new Date().toISOString() }
    await act(() => db.settings.put(next), 'Pengaturan perusahaan tersimpan.')
  }
  async function exportInvoice(invoice: Invoice) {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF()
    const logo = new Image(); logo.src = logoUrl; await logo.decode(); doc.addImage(logo, 'PNG', 14, 8, 20, 20)
    doc.setTextColor(158, 72, 91); doc.setFontSize(17); doc.text(settings.companyName || 'RANCAUPAS BEAUTY', 39, 17)
    doc.setTextColor(45, 40, 40); doc.setFontSize(10); doc.text([settings.companyAddress, settings.phone, settings.email].filter(Boolean).join(' | ') || 'Informasi perusahaan belum diatur', 39, 24)
    doc.setFontSize(16); doc.text(invoice.type === 'sale' ? 'INVOICE' : 'TAGIHAN PEMBELIAN', 14, 42); doc.setFontSize(10)
    doc.text(`Nomor: ${invoice.invoiceNumber}`, 14, 50); doc.text(`Tanggal: ${formatDate(invoice.issueDate)}    Jatuh tempo: ${formatDate(invoice.dueDate)}`, 14, 56)
    doc.text(`${invoice.type === 'sale' ? 'Pelanggan' : 'Pemasok'}: ${invoice.partyName}`, 14, 66); doc.text(invoice.partyAddress || '-', 14, 72)
    autoTable(doc, { startY: 80, head: [['Deskripsi', 'Qty', 'Satuan', 'Harga', 'Jumlah']], body: invoice.items.map((item) => [item.description, String(item.quantity), item.unit, formatMoney(item.unitPrice), formatMoney(item.quantity * item.unitPrice - item.discount)]), headStyles: { fillColor: [171, 89, 105] } })
    const finalY = (doc as JsPdf & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100
    doc.text(`Subtotal: ${formatMoney(invoice.subtotal)}`, 140, finalY + 10); doc.text(`Diskon: ${formatMoney(invoice.discount)}`, 140, finalY + 16); doc.text(`Pajak: ${formatMoney(invoice.tax)}`, 140, finalY + 22)
    doc.setFontSize(12); doc.text(`Total: ${formatMoney(invoice.total)}`, 140, finalY + 30); doc.setFontSize(10)
    doc.text(`Dibayar: ${formatMoney(invoice.amountPaid)}    Sisa: ${formatMoney(invoice.balanceDue)}`, 14, finalY + 40)
    if (invoice.notes) doc.text(`Catatan: ${invoice.notes}`, 14, finalY + 50, { maxWidth: 180 })
    if (settings.bankInfo) doc.text(`Pembayaran: ${settings.bankInfo}`, 14, finalY + 60, { maxWidth: 180 })
    doc.save(`${invoice.invoiceNumber.replaceAll('/', '-')}.pdf`)
    notify(`PDF ${invoice.invoiceNumber} dibuat.`)
  }
  async function exportReport(pdf = false) {
    const rows = filteredInvoices.map((invoice) => ({ Nomor: invoice.invoiceNumber, Tanggal: invoice.issueDate, Pihak: invoice.partyName, Jenis: invoice.type === 'sale' ? 'Penjualan' : 'Pembelian', Status: statusText[invoiceStatus(invoice)], Total: invoice.total, Dibayar: invoice.amountPaid, Sisa: invoice.balanceDue }))
    if (!pdf) return csvDownload('rekap-invoice.csv', rows)
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF(); doc.text('RANCAUPAS BEAUTY — Rekap Invoice', 14, 18)
    autoTable(doc, { startY: 25, head: [['Nomor', 'Tanggal', 'Pihak', 'Jenis', 'Status', 'Total', 'Dibayar', 'Sisa']], body: rows.map((row) => [row.Nomor, row.Tanggal, row.Pihak, row.Jenis, row.Status, formatMoney(row.Total), formatMoney(row.Dibayar), formatMoney(row.Sisa)]), styles: { fontSize: 8 }, headStyles: { fillColor: [171, 89, 105] } })
    doc.save('rekap-invoice.pdf')
  }
  async function restoreFile(file?: File) {
    if (!file || !window.confirm('Restore akan mengganti seluruh data lokal. Lanjutkan?')) return
    await act(() => restoreBackup(file), 'Backup berhasil dipulihkan.')
  }
  async function clearAll() {
    if (!window.confirm('Hapus seluruh data perusahaan dari browser ini?') || !window.confirm('Konfirmasi kedua: seluruh invoice, pembayaran, dan master data akan dihapus permanen.')) return
    await act(async () => db.transaction('rw', [db.customers, db.products, db.invoices, db.payments, db.transactions, db.settings], async () => { await Promise.all([db.customers.clear(), db.products.clear(), db.invoices.clear(), db.payments.clear(), db.transactions.clear(), db.settings.clear()]) }), 'Semua data lokal telah dihapus.')
  }
  const pageTitle = page === 'Dashboard' ? 'Ringkasan bisnis' : page
  const open = (next: Page) => { setPage(next); setMobileNav(false); setSearch('') }

  return <div className={`app-shell ${settings.theme === 'dark' ? 'theme-dark' : ''}`}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><img src={logoUrl} alt="Logo RANCAUPAS BEAUTY" /></div><div><strong>RANCAUPAS</strong><span>BEAUTY · BUSINESS DESK</span></div></div>
      <div className="workspace-label">WORKSPACE <span>LOCAL</span></div>
      <nav className="side-navigation" aria-label="Navigasi utama">{navigation.map((item, index) => { const Icon = item.icon; const previous = navigation[index - 1]; return <div key={item.label}>{item.group !== previous?.group && <p className="nav-group">{item.group}</p>}<button className={`nav-item ${page === item.label ? 'active' : ''}`} onClick={() => open(item.label)}><Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.label === 'Invoice' && invoices.filter((invoice) => invoiceStatus(invoice) === 'overdue').length > 0 && <i>{invoices.filter((invoice) => invoiceStatus(invoice) === 'overdue').length}</i>}</button></div> })}</nav>
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={16} /><span>Data tersimpan lokal<br /><b>di perangkat ini</b></span></div><button className="profile-row" onClick={() => open('Pengaturan')}><div className="avatar">RB</div><div><b>{settings.companyName}</b><span>Administrator</span></div><MoreHorizontal size={17} /></button></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Buka navigasi" onClick={() => setMobileNav(!mobileNav)}><Menu size={19} /></button><div className="breadcrumb"><span>RANCAUPAS BEAUTY</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-tools"><div className="today-label"><CalendarDays size={15} /><span>{longDate.format(new Date())}</span></div><span className="top-divider" /><button className="icon-button" aria-label="Ganti tema" title="Ganti tema" onClick={() => void act(() => db.settings.put({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark', updatedAt: new Date().toISOString() }), 'Tema diperbarui.')}>{settings.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="icon-button notification-button" aria-label="Invoice jatuh tempo" title="Invoice jatuh tempo" onClick={() => { setPage('Invoice'); setStatusFilter('overdue') }}><Bell size={17} />{invoices.some((invoice) => invoiceStatus(invoice) === 'overdue') && <i />}</button><div className="top-avatar">RB</div></div></header>
      <section className="page-content"><div className="page-heading"><div><div className="eyebrow">{page === 'Dashboard' ? 'RINGKASAN · USAHA' : 'RANCAUPAS BEAUTY · WORKSPACE'}</div><h1>{pageTitle}</h1><p>{page === 'Dashboard' ? 'Pantau performa dan arus kas bisnis Anda.' : pageDescription(page)}</p></div><div className="heading-actions">{page === 'Dashboard' && <select className="period-select" value={range} onChange={(event) => setRange(event.target.value)}><option value="month">Bulan ini</option><option value="year">Tahun ini</option><option value="all">Semua waktu</option></select>}{(page === 'Dashboard' || page === 'Invoice') && <button className="button button-primary" onClick={() => openInvoice()}><Plus size={16} /> Invoice baru</button>}</div></div>
        {loading ? <div className="loading-state"><span className="spinner" /> Memuat data lokal…</div> : <>
          {page === 'Dashboard' && <Dashboard invoices={invoices} transactions={transactions} customers={customers} monthlyData={monthlyData} turnover={turnover} income={income} expense={expense} receivable={receivable} payable={payable} onOpenInvoice={openInvoice} onViewInvoices={() => open('Invoice')} />}
          {page === 'Invoice' && <InvoicePage invoices={filteredInvoices} query={search} setQuery={setSearch} status={statusFilter} setStatus={setStatusFilter} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} onNew={() => openInvoice()} onEdit={openInvoice} onPay={(invoice) => { setPaymentInvoice(invoice); setModal('payment') }} onDelete={removeInvoice} onPdf={exportInvoice} onCsv={() => csvDownload('invoice.csv', invoices.map((item) => ({ Nomor: item.invoiceNumber, Pihak: item.partyName, Tanggal: item.issueDate, JatuhTempo: item.dueDate, Status: statusText[invoiceStatus(item)], Total: item.total, Dibayar: item.amountPaid, Sisa: item.balanceDue })))} />}
          {page === 'Data Pelanggan' && <CustomersPage customers={customers} invoices={invoices} search={search} setSearch={setSearch} onAdd={() => { setEditingCustomer(null); setModal('customer') }} onEdit={(item) => { setEditingCustomer(item); setModal('customer') }} onToggle={toggleCustomer} onExport={() => csvDownload('pelanggan.csv', customers.map((item) => ({ Kode: item.customerCode, Nama: item.name, Perusahaan: item.companyName, Telepon: item.phone, Email: item.email, Alamat: item.address, Status: item.isActive ? 'Aktif' : 'Nonaktif' })))} />}
          {page === 'Data Produk dan Jasa' && <ProductsPage products={products} search={search} setSearch={setSearch} onAdd={() => { setEditingProduct(null); setModal('product') }} onEdit={(item) => { setEditingProduct(item); setModal('product') }} onExport={() => csvDownload('produk.csv', products.map((item) => ({ Kode: item.productCode, Nama: item.name, Kategori: item.category, Satuan: item.unit, HargaJual: item.sellingPrice, HargaModal: item.costPrice, Status: item.isActive ? 'Aktif' : 'Nonaktif' })))} onToggle={(item) => void act(() => db.products.update(item.id!, { isActive: !item.isActive, updatedAt: new Date().toISOString() }), 'Status produk diperbarui.')} />}
          {['Transaksi', 'Pemasukan', 'Pengeluaran'].includes(page) && <TransactionsPage page={page} transactions={transactions.filter((item) => page === 'Pemasukan' ? item.type === 'income' : page === 'Pengeluaran' ? item.type === 'expense' : true)} search={search} setSearch={setSearch} onAdd={() => setModal('transaction')} onExport={() => csvDownload('transaksi.csv', transactions.map((item) => ({ Nomor: item.transactionNumber, Tanggal: item.date, Jenis: item.type, Kategori: item.category, Deskripsi: item.description, Nominal: item.amount, Metode: item.paymentMethod, Invoice: item.invoiceId })))} />}
          {(page === 'Rekap Data' || page === 'Laporan') && <ReportsPage invoices={invoices} transactions={transactions} customers={customers} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} onCsv={() => exportReport(false)} onPdf={() => exportReport(true)} />}
          {page === 'Pengaturan' && <SettingsPage settings={settings} onSave={saveSettings} onBackup={() => void exportBackup().then(() => notify('Backup berhasil diunduh.')).catch(() => notify('Backup gagal dibuat.', 'error'))} onRestore={restoreFile} onClear={() => void clearAll()} />}
        </>}
      </section></main>
    {mobileNav && <button className="nav-scrim" aria-label="Tutup navigasi" onClick={() => setMobileNav(false)} />}
    {toast && <div className={`toast toast-${toast.kind}`} role="status"><span>{toast.kind === 'success' ? <Check size={16} /> : <X size={16} />}</span>{toast.message}</div>}
    {modal === 'invoice' && <InvoiceModal invoice={editingInvoice} customers={customers.filter((item) => item.isActive)} defaultTax={settings.defaultTax} onClose={() => { setModal(null); setEditingInvoice(null) }} onSubmit={submitInvoice} />}
    {modal === 'customer' && <FormModal title={editingCustomer ? 'Edit pelanggan' : 'Pelanggan baru'} onClose={() => { setModal(null); setEditingCustomer(null) }} onSubmit={saveCustomer}><div className="form-grid"><Field label="Nama pelanggan *" name="name" defaultValue={editingCustomer?.name} required /><Field label="Nama perusahaan" name="companyName" defaultValue={editingCustomer?.companyName} /><Field label="Nomor telepon" name="phone" defaultValue={editingCustomer?.phone} /><Field label="Email" name="email" type="email" defaultValue={editingCustomer?.email} /><Field label="Alamat" name="address" defaultValue={editingCustomer?.address} wide /><Field label="Catatan" name="notes" defaultValue={editingCustomer?.notes} wide /></div></FormModal>}
    {modal === 'product' && <FormModal title={editingProduct ? 'Edit produk atau jasa' : 'Produk atau jasa baru'} onClose={() => { setModal(null); setEditingProduct(null) }} onSubmit={saveProduct}><div className="form-grid"><Field label="Nama produk atau jasa *" name="name" defaultValue={editingProduct?.name} required wide /><Field label="Kategori" name="category" defaultValue={editingProduct?.category ?? 'Umum'} /><Field label="Satuan" name="unit" defaultValue={editingProduct?.unit ?? 'pcs'} /><Field label="Harga jual (Rp) *" name="price" type="number" min="0" step="1" defaultValue={editingProduct?.sellingPrice ?? 0} required /><Field label="Harga modal (Rp)" name="costPrice" type="number" min="0" step="1" defaultValue={editingProduct?.costPrice ?? 0} /><Field label="Stok" name="stock" type="number" min="0" step="0.01" defaultValue={editingProduct?.stock ?? 0} /><Field label="Deskripsi" name="description" defaultValue={editingProduct?.description} wide /></div></FormModal>}
    {modal === 'transaction' && <FormModal title="Catat transaksi" onClose={() => setModal(null)} onSubmit={saveManualTransaction}><div className="form-grid"><label className="field"><span>Jenis transaksi</span><select name="type"><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></label><Field label="Tanggal" name="date" type="date" defaultValue={today()} required /><Field label="Kategori" name="category" placeholder="Contoh: Operasional" required /><Field label="Nominal (Rp)" name="amount" type="number" min="1" step="1" required /><Field label="Deskripsi" name="description" required /><label className="field"><span>Metode pembayaran</span><select name="method"><option>Tunai</option><option>Transfer bank</option><option>QRIS</option><option>Kartu</option><option>Lainnya</option></select></label><Field label="Catatan" name="notes" wide /></div></FormModal>}
    {modal === 'payment' && paymentInvoice && <FormModal title={`Catat pembayaran · ${paymentInvoice.invoiceNumber}`} onClose={() => { setModal(null); setPaymentInvoice(null) }} onSubmit={submitPayment}><p className="payment-balance">Sisa tagihan <strong>{formatMoney(paymentInvoice.balanceDue)}</strong></p><div className="form-grid"><Field label="Tanggal pembayaran" name="date" type="date" defaultValue={today()} required /><Field label="Nominal (Rp)" name="amount" type="number" min="1" max={paymentInvoice.balanceDue} step="1" required /><label className="field"><span>Metode pembayaran</span><select name="method"><option>Transfer bank</option><option>Tunai</option><option>QRIS</option><option>Kartu</option><option>Lainnya</option></select></label><Field label="Nomor referensi" name="reference" /><Field label="Catatan" name="notes" wide /></div></FormModal>}
  </div>
}

function pageDescription(page: Page) {
  const copy: Partial<Record<Page, string>> = { Invoice: 'Buat, pantau, dan kelola dokumen penjualan maupun pembelian.', 'Data Pelanggan': 'Simpan kontak dan lihat ringkasan aktivitas pelanggan.', 'Data Produk dan Jasa': 'Kelola katalog, harga jual, dan ketersediaan item.', Transaksi: 'Semua arus kas yang tercatat, dari invoice dan input manual.', Pemasukan: 'Uang yang benar-benar diterima perusahaan.', Pengeluaran: 'Biaya dan pembelian yang sudah dibayarkan.', 'Rekap Data': 'Ringkasan invoice dan transaksi berdasarkan periode.', Laporan: 'Analisis dan ekspor data bisnis.', Pengaturan: 'Preferensi perusahaan dan pengelolaan data lokal.' }
  return copy[page] ?? ''
}

function Dashboard({ invoices, transactions, customers, monthlyData, turnover, income, expense, receivable, payable, onOpenInvoice, onViewInvoices }: { invoices: Invoice[]; transactions: Transaction[]; customers: Customer[]; monthlyData: Array<{ month: string; income: number; expense: number }>; turnover: number; income: number; expense: number; receivable: number; payable: number; onOpenInvoice: (invoice?: Invoice) => void; onViewInvoices: () => void }) {
  const outstanding = invoices.filter((item) => item.type === 'sale' && ['unpaid', 'partial', 'overdue'].includes(invoiceStatus(item)))
  const stats = [{ label: 'Omzet bulan ini', value: formatMoney(turnover), icon: TrendingUp, tone: 'rose', note: 'Nilai invoice penjualan' }, { label: 'Uang masuk', value: formatMoney(income), icon: ArrowDownLeft, tone: 'green', note: 'Pembayaran diterima' }, { label: 'Pengeluaran', value: formatMoney(expense), icon: ArrowUpRight, tone: 'amber', note: 'Biaya tercatat' }, { label: 'Laba bersih', value: formatMoney(income - expense), icon: CircleDollarSign, tone: 'dark', note: 'Kas masuk dikurangi keluar' }]
  return <><div className="stats-grid">{stats.map((stat) => { const Icon = stat.icon; return <article className="stat-card" key={stat.label}><div className="stat-top"><span>{stat.label}</span><i className={`stat-icon ${stat.tone}`}><Icon size={17} /></i></div><strong>{stat.value}</strong><small>{stat.note}</small></article> })}</div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Arus kas</h2><p>Pemasukan dan pengeluaran per bulan</p></div><span className="panel-meta"><i className="legend-dot income-dot" /> Masuk <i className="legend-dot expense-dot" /> Keluar</span></div>{transactions.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={monthlyData} margin={{ top: 10, right: 8, bottom: 0, left: 2 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value: number) => value >= 1000000 ? `${(value / 1000000).toFixed(0)}jt` : `${Math.round(value / 1000)}rb`} width={38} /><Tooltip formatter={(value) => formatMoney(Number(value))} contentStyle={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }} /><Line type="monotone" dataKey="income" name="Pemasukan" stroke="#448b73" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="expense" name="Pengeluaran" stroke="#cc816b" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer></div> : <EmptyState icon={BarChart3} title="Belum ada aktivitas keuangan" detail="Grafik terisi setelah transaksi atau pembayaran dicatat." />}</section>
      <section className="panel receivable-panel"><div className="panel-heading"><div><h2>Perlu perhatian</h2><p>Tagihan penjualan yang belum lunas</p></div><span className="count-pill">{outstanding.length}</span></div>{outstanding.length ? <div className="attention-list">{outstanding.slice(0, 4).map((invoice) => <button className="attention-row" key={invoice.id} onClick={onViewInvoices}><span className="attention-mark"><FileText size={15} /></span><span className="attention-info"><b>{invoice.partyName}</b><small>{invoice.invoiceNumber}</small></span><span className="attention-value"><b>{formatMoney(invoice.balanceDue)}</b><small className={invoiceStatus(invoice) === 'overdue' ? 'text-danger' : ''}>{statusText[invoiceStatus(invoice)]}</small></span></button>)}</div> : <EmptyState icon={Check} title="Semua tagihan beres" detail="Invoice terbuka akan tampil di sini." compact />}<div className="balance-strip"><span>Piutang usaha</span><b>{formatMoney(receivable)}</b><span>Utang pemasok</span><b>{formatMoney(payable)}</b></div></section></div>
    <div className="dashboard-grid lower-grid"><section className="panel"><div className="panel-heading"><div><h2>Invoice terbaru</h2><p>Dokumen penjualan dan pembelian</p></div><button className="text-button" onClick={onViewInvoices}>Lihat semua <ArrowDownRight size={14} /></button></div>{invoices.length ? <div className="table-scroll"><table><thead><tr><th>Nomor</th><th>Pihak</th><th>Tanggal</th><th>Status</th><th className="align-right">Total</th></tr></thead><tbody>{invoices.slice(0, 5).map((invoice) => <tr key={invoice.id} onClick={() => onOpenInvoice(invoice)}><td className="strong-cell">{invoice.invoiceNumber}</td><td>{invoice.partyName}</td><td>{formatDate(invoice.issueDate)}</td><td><StatusBadge status={invoiceStatus(invoice)} /></td><td className="align-right strong-cell">{formatMoney(invoice.total)}</td></tr>)}</tbody></table></div> : <EmptyState icon={FileText} title="Belum ada invoice" detail="Invoice yang dibuat akan muncul di sini." />}</section>
      <section className="panel activity-panel"><div className="panel-heading"><div><h2>Aktivitas terbaru</h2><p>Catatan arus kas terbaru</p></div><Activity size={17} className="subtle-icon" /></div>{transactions.length ? <div className="activity-list">{transactions.slice(0, 5).map((item) => <div className="activity-row" key={item.id}><span className={`activity-icon ${item.type}`}>{item.type === 'income' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><div className="activity-copy"><b>{item.description}</b><small>{formatDate(item.date)} · {item.category}</small></div><strong className={item.type === 'income' ? 'text-green' : ''}>{item.type === 'income' ? '+' : '−'}{formatMoney(item.amount)}</strong></div>)}</div> : <EmptyState icon={Wallet} title="Belum ada transaksi" detail="Pembayaran invoice tercatat otomatis." compact />}<div className="mini-summary"><span><Users size={14} /> Pelanggan aktif</span><b>{customers.filter((item) => item.isActive).length}</b><span><FileText size={14} /> Total invoice</span><b>{invoices.length}</b></div></section></div></>
}

function InvoicePage({ invoices, query, setQuery, status, setStatus, fromDate, setFromDate, toDate, setToDate, onNew, onEdit, onPay, onDelete, onPdf, onCsv }: { invoices: Invoice[]; query: string; setQuery: (value: string) => void; status: string; setStatus: (value: string) => void; fromDate: string; setFromDate: (value: string) => void; toDate: string; setToDate: (value: string) => void; onNew: () => void; onEdit: (invoice: Invoice) => void; onPay: (invoice: Invoice) => void; onDelete: (invoice: Invoice) => void; onPdf: (invoice: Invoice) => void; onCsv: () => void }) {
  return <section className="panel data-panel"><div className="toolbar"><SearchInput value={query} onChange={setQuery} placeholder="Cari nomor atau pelanggan…" /><select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Semua status</option>{Object.entries(statusText).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><DateFilter label="Dari" value={fromDate} onChange={setFromDate} /><DateFilter label="Sampai" value={toDate} onChange={setToDate} /><button className="button button-quiet" onClick={onCsv}><Download size={15} /> CSV</button><button className="button button-primary toolbar-add" onClick={onNew}><Plus size={16} /> Buat invoice</button></div>{invoices.length ? <div className="table-scroll"><table><thead><tr><th>Nomor dokumen</th><th>Pelanggan / pemasok</th><th>Tanggal</th><th>Jatuh tempo</th><th>Status</th><th className="align-right">Total</th><th className="align-right">Sisa</th><th /></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td className="strong-cell"><button className="cell-link" onClick={() => onEdit(invoice)}>{invoice.invoiceNumber}</button><small className="cell-sub">{invoice.type === 'sale' ? 'Penjualan' : 'Pembelian'}</small></td><td>{invoice.partyName}</td><td>{formatDate(invoice.issueDate)}</td><td>{formatDate(invoice.dueDate)}</td><td><StatusBadge status={invoiceStatus(invoice)} /></td><td className="align-right">{formatMoney(invoice.total)}</td><td className="align-right strong-cell">{formatMoney(invoice.balanceDue)}</td><td><div className="row-actions"><button title="Unduh PDF" aria-label="Unduh PDF" onClick={() => onPdf(invoice)}><FileDown size={15} /></button>{invoice.balanceDue > 0 && invoice.status !== 'cancelled' && <button title="Catat pembayaran" aria-label="Catat pembayaran" onClick={() => onPay(invoice)}><CircleDollarSign size={15} /></button>}<button title="Hapus invoice" aria-label="Hapus invoice" onClick={() => onDelete(invoice)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState icon={FileText} title="Invoice belum ditemukan" detail="Buat invoice pertama atau ubah filter pencarian." action={<button className="button button-primary" onClick={onNew}><Plus size={15} /> Buat invoice</button>} />}</section>
}

function CustomersPage({ customers, invoices, search, setSearch, onAdd, onEdit, onToggle, onExport }: { customers: Customer[]; invoices: Invoice[]; search: string; setSearch: (value: string) => void; onAdd: () => void; onEdit: (item: Customer) => void; onToggle: (item: Customer) => void; onExport: () => void }) {
  const rows = customers.filter((item) => `${item.name} ${item.companyName} ${item.customerCode}`.toLowerCase().includes(search.toLowerCase()))
  return <DataPanel search={search} setSearch={setSearch} placeholder="Cari nama atau kode pelanggan…" onAdd={onAdd} onExport={onExport} addLabel="Tambah pelanggan" emptyIcon={Users} emptyTitle="Belum ada pelanggan" emptyText="Tambahkan data pelanggan agar dapat dipilih saat membuat invoice." headers={['Pelanggan', 'Kontak', 'Invoice', 'Total transaksi', 'Piutang', 'Status', '']} rows={rows.map((item) => { const related = invoices.filter((invoice) => invoice.customerId === item.id); return [<Person name={item.name} sub={item.companyName || item.customerCode} />, item.phone || item.email || '—', related.length, formatMoney(related.reduce((sum, invoice) => sum + invoice.total, 0)), formatMoney(related.filter((invoice) => invoice.type === 'sale').reduce((sum, invoice) => sum + invoice.balanceDue, 0)), <StatusBadge status={item.isActive ? 'active' : 'inactive'} />, <span className="row-actions"><button className="icon-button" title="Edit pelanggan" onClick={() => onEdit(item)}><Settings2 size={15} /></button><button className="icon-button" title="Ubah status pelanggan" onClick={() => void onToggle(item)}><MoreHorizontal size={17} /></button></span>] })} />
}

function ProductsPage({ products, search, setSearch, onAdd, onEdit, onExport, onToggle }: { products: Product[]; search: string; setSearch: (value: string) => void; onAdd: () => void; onEdit: (item: Product) => void; onExport: () => void; onToggle: (item: Product) => void }) {
  const rows = products.filter((item) => `${item.name} ${item.productCode} ${item.category}`.toLowerCase().includes(search.toLowerCase()))
  return <DataPanel search={search} setSearch={setSearch} placeholder="Cari produk atau kode…" onAdd={onAdd} onExport={onExport} addLabel="Tambah item" emptyIcon={Boxes} emptyTitle="Katalog masih kosong" emptyText="Produk dan jasa dapat dipilih langsung pada form invoice." headers={['Produk / jasa', 'Kategori', 'Satuan', 'Harga jual', 'Harga modal', 'Status', '']} rows={rows.map((item) => [<Person name={item.name} sub={item.productCode} product />, item.category, item.unit, <span className="strong-cell">{formatMoney(item.sellingPrice)}</span>, item.costPrice ? formatMoney(item.costPrice) : '—', <StatusBadge status={item.isActive ? 'active' : 'inactive'} />, <span className="row-actions"><button className="icon-button" title="Edit produk" onClick={() => onEdit(item)}><Settings2 size={15} /></button><button className="icon-button" title="Ubah status produk" onClick={() => onToggle(item)}><MoreHorizontal size={17} /></button></span>])} />
}

function DataPanel({ search, setSearch, placeholder, onAdd, onExport, addLabel, emptyIcon, emptyTitle, emptyText, headers, rows }: { search: string; setSearch: (value: string) => void; placeholder: string; onAdd: () => void; onExport: () => void; addLabel: string; emptyIcon: typeof Users; emptyTitle: string; emptyText: string; headers: string[]; rows: ReactNode[][] }) {
  return <section className="panel data-panel"><div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder={placeholder} /><button className="button button-quiet" onClick={onExport}><Download size={15} /> CSV</button><button className="button button-primary" onClick={onAdd}><Plus size={16} /> {addLabel}</button></div>{rows.length ? <div className="table-scroll"><table><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`} className={['Total transaksi', 'Piutang', 'Harga jual', 'Harga modal'].includes(header) ? 'align-right' : ''}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={['Total transaksi', 'Piutang', 'Harga jual', 'Harga modal'].includes(headers[cellIndex]) ? 'align-right' : ''}>{cell}</td>)}</tr>)}</tbody></table></div> : <EmptyState icon={emptyIcon} title={emptyTitle} detail={emptyText} action={<button className="button button-primary" onClick={onAdd}><Plus size={15} /> {addLabel}</button>} />}</section>
}

function TransactionsPage({ page, transactions, search, setSearch, onAdd, onExport }: { page: string; transactions: Transaction[]; search: string; setSearch: (value: string) => void; onAdd: () => void; onExport: () => void }) {
  const rows = transactions.filter((item) => `${item.description} ${item.category} ${item.transactionNumber}`.toLowerCase().includes(search.toLowerCase()))
  const sum = rows.reduce((total, item) => total + item.amount, 0)
  return <><div className="summary-strip"><div><span>{page === 'Transaksi' ? 'Total transaksi' : page === 'Pemasukan' ? 'Total pemasukan' : 'Total pengeluaran'}</span><b>{rows.length}</b></div><div><span>Nilai pada tampilan</span><b>{formatMoney(sum)}</b></div><div><span>Rentang</span><b>{page === 'Transaksi' ? 'Semua waktu' : page}</b></div></div><section className="panel data-panel"><div className="toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Cari transaksi…" /><button className="button button-quiet" onClick={onExport}><Download size={15} /> Ekspor CSV</button><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Catat transaksi</button></div>{rows.length ? <div className="table-scroll"><table><thead><tr><th>Nomor</th><th>Tanggal</th><th>Deskripsi</th><th>Kategori</th><th>Metode</th><th className="align-right">Nominal</th><th>Referensi</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td className="strong-cell">{item.transactionNumber}</td><td>{formatDate(item.date)}</td><td>{item.description}</td><td>{item.category}</td><td>{item.paymentMethod}</td><td className={`align-right strong-cell ${item.type === 'income' ? 'text-green' : ''}`}>{item.type === 'income' ? '+' : '−'}{formatMoney(item.amount)}</td><td>{item.invoiceId ? `Invoice #${item.invoiceId}` : 'Manual'}</td></tr>)}</tbody></table></div> : <EmptyState icon={Wallet} title="Belum ada transaksi" detail="Pembayaran invoice tercatat otomatis. Transaksi lain dapat ditambahkan manual." action={<button className="button button-primary" onClick={onAdd}><Plus size={15} /> Catat transaksi</button>} />}</section></>
}

function ReportsPage({ invoices, transactions, customers, fromDate, setFromDate, toDate, setToDate, onCsv, onPdf }: { invoices: Invoice[]; transactions: Transaction[]; customers: Customer[]; fromDate: string; setFromDate: (value: string) => void; toDate: string; setToDate: (value: string) => void; onCsv: () => void; onPdf: () => void }) {
  const docs = invoices.filter((item) => (!fromDate || item.issueDate >= fromDate) && (!toDate || item.issueDate <= toDate) && item.status !== 'cancelled')
  const cash = transactions.filter((item) => (!fromDate || item.date >= fromDate) && (!toDate || item.date <= toDate))
  const sales = docs.filter((item) => item.type === 'sale'); const purchases = docs.filter((item) => item.type === 'purchase')
  const paid = cash.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0); const costs = cash.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const metrics = [['Nilai invoice penjualan', formatMoney(sales.reduce((sum, item) => sum + item.total, 0))], ['Pembayaran diterima', formatMoney(paid)], ['Piutang usaha', formatMoney(sales.reduce((sum, item) => sum + item.balanceDue, 0))], ['Tagihan pemasok', formatMoney(purchases.reduce((sum, item) => sum + item.balanceDue, 0))], ['Pengeluaran tercatat', formatMoney(costs)], ['Estimasi laba bersih', formatMoney(paid - costs)]]
  return <><div className="report-filters panel"><div className="report-filter-copy"><h2>Periode laporan</h2><p>Invoice berdasarkan tanggal terbit, transaksi berdasarkan tanggal pencatatan.</p></div><div className="toolbar"><DateFilter label="Dari" value={fromDate} onChange={setFromDate} /><DateFilter label="Sampai" value={toDate} onChange={setToDate} /><button className="button button-quiet" onClick={onCsv}><Download size={15} /> CSV</button><button className="button button-secondary" onClick={onPdf}><FileDown size={15} /> PDF</button></div></div><div className="report-metrics">{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div><section className="panel data-panel report-table"><div className="panel-heading"><div><h2>Ringkasan per pelanggan</h2><p>Nilai penjualan dan piutang berdasarkan invoice terpilih.</p></div><span className="count-pill">{customers.length}</span></div><div className="table-scroll"><table><thead><tr><th>Pelanggan</th><th>Invoice</th><th className="align-right">Nilai invoice</th><th className="align-right">Dibayar</th><th className="align-right">Piutang</th></tr></thead><tbody>{customers.map((customer) => { const related = sales.filter((item) => item.customerId === customer.id); if (!related.length) return null; return <tr key={customer.id}><td>{customer.name}</td><td>{related.length}</td><td className="align-right">{formatMoney(related.reduce((sum, item) => sum + item.total, 0))}</td><td className="align-right">{formatMoney(related.reduce((sum, item) => sum + item.amountPaid, 0))}</td><td className="align-right strong-cell">{formatMoney(related.reduce((sum, item) => sum + item.balanceDue, 0))}</td></tr> })}</tbody></table></div></section></>
}

function SettingsPage({ settings, onSave, onBackup, onRestore, onClear }: { settings: CompanySettings; onSave: (event: FormEvent<HTMLFormElement>) => void; onBackup: () => void; onRestore: (file?: File) => void; onClear: () => void }) {
  return <div className="settings-layout"><form className="panel settings-panel" onSubmit={onSave}><div className="panel-heading"><div><h2>Profil perusahaan</h2><p>Informasi ini digunakan pada dokumen invoice.</p></div><Settings2 size={18} className="subtle-icon" /></div><div className="settings-form"><Field label="Nama perusahaan" name="companyName" defaultValue={settings.companyName} /><Field label="Awalan nomor dokumen" name="prefix" defaultValue={settings.invoicePrefix} maxLength={8} /><Field label="Nomor telepon" name="phone" defaultValue={settings.phone} /><Field label="Email" name="email" type="email" defaultValue={settings.email} /><Field label="Pajak default (%)" name="tax" type="number" min="0" max="100" step="0.1" defaultValue={settings.defaultTax} /><Field label="Alamat perusahaan" name="address" defaultValue={settings.companyAddress} wide /><Field label="Rekening pembayaran" name="bankInfo" defaultValue={settings.bankInfo} wide /><Field label="Syarat pembayaran default" name="terms" defaultValue={settings.paymentTerms} wide /></div><div className="panel-footer"><span>Nomor invoice berikutnya: {settings.invoicePrefix}/{new Date().getFullYear()}/{String(settings.invoiceCounter).padStart(4, '0')}</span><button className="button button-primary" type="submit"><Check size={15} /> Simpan pengaturan</button></div></form><section className="panel backup-panel"><div className="panel-heading"><div><h2>Data lokal & backup</h2><p>Data tersimpan di profil browser ini.</p></div><ShieldCheck size={18} className="subtle-icon" /></div><div className="backup-notice"><ShieldCheck size={17} /><span>Data tidak dikirim ke server. Simpan backup berkala di lokasi yang aman.</span></div><button className="backup-action" onClick={onBackup}><span><Download size={17} /></span><div><b>Unduh backup</b><small>Ekspor seluruh data ke satu file JSON.</small></div><ArrowDownRight size={16} /></button><label className="backup-action upload-backup"><span><FileDown size={17} /></span><div><b>Pulihkan backup</b><small>Impor file backup JSON tersimpan.</small></div><input type="file" accept="application/json,.json" onChange={(event) => { onRestore(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /><ArrowDownRight size={16} /></label><div className="danger-zone"><div><b>Hapus seluruh data lokal</b><small>Tindakan ini tidak dapat dibatalkan.</small></div><button className="button button-danger" onClick={onClear}><Trash2 size={15} /> Hapus data</button></div></section></div>
}

function InvoiceModal({ invoice, customers, defaultTax, onClose, onSubmit }: { invoice: Invoice | null; customers: Customer[]; defaultTax: number; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>, items: InvoiceItem[]) => void }) {
  const [items, setItems] = useState<InvoiceItem[]>(invoice?.items ?? [{ productCode: '', description: '', quantity: 1, unit: 'pcs', unitPrice: 0, discount: 0 }])
  const [discount, setDiscount] = useState(invoice?.discount ?? 0)
  const [taxPercent, setTaxPercent] = useState(invoice ? invoice.tax / Math.max(invoice.total - invoice.tax, 1) * 100 : defaultTax)
  const calculated = totals(items, discount, taxPercent)
  function changeItem(index: number, patch: Partial<InvoiceItem>) { setItems((old) => old.map((item, current) => current === index ? { ...item, ...patch } : item)) }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal invoice-modal" onSubmit={(event) => onSubmit(event, items)}><div className="modal-header"><div><span className="eyebrow">DOKUMEN BARU</span><h2>{invoice ? `Edit ${invoice.invoiceNumber}` : 'Buat invoice'}</h2></div><button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X size={18} /></button></div><div className="modal-body"><div className="form-grid"><label className="field"><span>Jenis dokumen</span><select name="type" defaultValue={invoice?.type ?? 'sale'} disabled={!!invoice}><option value="sale">Invoice penjualan</option><option value="purchase">Tagihan pemasok</option></select></label><label className="field"><span>Pilih pelanggan / pemasok</span><select name="customerId" defaultValue={invoice?.customerId ?? ''}><option value="">Isi nama manual</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Field label="Nama pelanggan / pemasok *" name="partyName" defaultValue={invoice?.partyName} required /><Field label="Telepon" name="partyPhone" defaultValue={invoice?.partyPhone} /><Field label="Alamat" name="partyAddress" defaultValue={invoice?.partyAddress} wide /><Field label="Tanggal invoice" name="issueDate" type="date" defaultValue={invoice?.issueDate ?? today()} required /><Field label="Jatuh tempo" name="dueDate" type="date" defaultValue={invoice?.dueDate ?? today()} required /></div><div className="item-editor-heading"><div><h3>Rincian item</h3><p>Isi detail item secara manual.</p></div><button type="button" className="button button-quiet" onClick={() => setItems([...items, { productCode: '', description: '', quantity: 1, unit: 'pcs', unitPrice: 0, discount: 0 }])}><Plus size={14} /> Tambah baris</button></div><div className="invoice-item-list">{items.map((item, index) => <div className="invoice-item-row" key={index}><div className="item-description"><Field label="Kode item" name={`code-${index}`} value={item.productCode} onChange={(event) => changeItem(index, { productCode: event.target.value })} /><Field label="Deskripsi" name={`description-${index}`} value={item.description} onChange={(event) => changeItem(index, { description: event.target.value })} required /></div><Field label="Qty" name={`qty-${index}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeItem(index, { quantity: Number(event.target.value) })} required /><Field label="Satuan" name={`unit-${index}`} value={item.unit} onChange={(event: React.ChangeEvent<HTMLInputElement>) => changeItem(index, { unit: event.target.value })} /><MoneyField label="Harga (Rp)" name={`price-${index}`} value={item.unitPrice} onChange={(value) => changeItem(index, { unitPrice: value })} required /><MoneyField label="Diskon (Rp)" name={`discount-${index}`} value={item.discount} onChange={(value) => changeItem(index, { discount: value })} /><button type="button" className="icon-button remove-item" aria-label="Hapus item" disabled={items.length === 1} onClick={() => setItems(items.filter((_, current) => current !== index))}><Trash2 size={15} /></button></div>)}</div><div className="form-grid invoice-extras"><MoneyField label="Diskon keseluruhan (Rp)" name="discount" value={discount} onChange={setDiscount} /><Field label={`Pajak (%) · default ${defaultTax}%`} name="tax" type="number" min="0" max="100" step="0.1" value={taxPercent} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaxPercent(Number(event.target.value))} /><Field label="Catatan / syarat pembayaran" name="notes" defaultValue={invoice?.notes} wide /></div><div className="invoice-totals"><span>Subtotal <b>{formatMoney(calculated.subtotal)}</b></span><span>Diskon item <b>{formatMoney(items.reduce((sum, item) => sum + item.discount, 0))}</b></span><span>Pajak <b>{formatMoney(calculated.tax)}</b></span><strong>Total <b>{formatMoney(calculated.total)}</b></strong>{invoice && <small>Pembayaran tercatat {formatMoney(invoice.amountPaid)} · sisa {formatMoney(Math.max(0, calculated.total - invoice.amountPaid))}</small>}</div></div><div className="modal-footer"><button type="button" className="button button-quiet" onClick={onClose}>Batal</button><button className="button button-primary" type="submit"><Check size={15} /> {invoice ? 'Simpan perubahan' : 'Simpan invoice'}</button></div></form></div>
}

function FormModal({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal small-modal" onSubmit={onSubmit}><div className="modal-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X size={18} /></button></div><div className="modal-body">{children}</div><div className="modal-footer"><button type="button" className="button button-quiet" onClick={onClose}>Batal</button><button className="button button-primary" type="submit"><Check size={15} /> Simpan</button></div></form></div>
}

function parseMoneyInput(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function formatMoneyInput(value: number) {
  return value > 0 ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value) : ''
}

function MoneyField({ label, name, value, onChange, required = false }: { label: string; name: string; value: number; onChange: (value: number) => void; required?: boolean }) {
  return <label className="field"><span>{label}</span><input name={name} type="text" inputMode="numeric" value={formatMoneyInput(value)} onChange={(event) => onChange(parseMoneyInput(event.target.value))} required={required} /></label>
}

function Field({ label, name, type = 'text', defaultValue, value, required, wide, min, max, step, maxLength, placeholder, onChange }: { label: string; name: string; type?: string; defaultValue?: string | number; value?: string | number; required?: boolean; wide?: boolean; min?: string | number; max?: string | number; step?: string | number; maxLength?: number; placeholder?: string; onChange?: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const multiline = ['address', 'notes', 'bankInfo', 'terms'].includes(name)
  return <label className={`field ${wide ? 'field-wide' : ''}`}><span>{label}</span>{multiline ? <textarea name={name} defaultValue={defaultValue} value={value} required={required} placeholder={placeholder} maxLength={maxLength} /> : <input name={name} type={type} defaultValue={defaultValue} value={value} required={required} min={min} max={max} step={step} maxLength={maxLength} placeholder={placeholder} onChange={onChange} />}</label>
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="search-box"><Search size={16} /><input placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="date-filter"><span>{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label> }
function StatusBadge({ status }: { status: string }) { return <span className={`status-badge status-${status}`}><i />{statusText[status] ?? (status === 'active' ? 'Aktif' : 'Nonaktif')}</span> }
function EmptyState({ icon: Icon, title, detail, action, compact = false }: { icon: typeof FileText; title: string; detail: string; action?: ReactNode; compact?: boolean }) { return <div className={`empty-state ${compact ? 'empty-compact' : ''}`}><span className="empty-icon"><Icon size={19} /></span><b>{title}</b><p>{detail}</p>{action}</div> }
function Person({ name, sub, product = false }: { name: string; sub: string; product?: boolean }) { return <span className={product ? 'product-cell' : 'person-cell'}><i>{product ? <ShoppingBag size={15} /> : name.slice(0, 1).toUpperCase()}</i><span><b>{name}</b><small>{sub}</small></span></span> }
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric-card"><span>{label}</span><b>{value}</b></article> }

export default AppShell